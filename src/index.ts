import type { DeepPartial, Timeout } from 'typestar'
import { deepMergeObj, isEmptyObj, isError, isObj, isString, keysOf, min, noop, stringify } from 'compresso'
import mitt, { type Emitter, type Handler } from 'mitt'
import type { SocketConfig } from './interfaces'
import type { OutData, SocketCallback, SocketEvent, SocketEventData, UrlProvider } from './types'

interface Timers {
  [key: string]: Timeout | undefined
  heartbeat?: Timeout
  keepAlive?: Timeout
  ping?: Timeout
  retry?: Timeout
}

const PingContent = '{"type":"ping"}'
const PongContent = '{"type":"pong"}'

const DefaultOptions: SocketConfig = {
  binary: 'blob',
  buffer: {
    max: 32,
    min: 0
  },
  immediate: false,
  ping: {
    heartbeat: 5000,
    strict: true,
    timeout: 5000
  },
  retry: {
    amount: 0,
    delayFactor: 1.5,
    maxDelay: 30000,
    minUpTime: 500,
    onAbort: false,
    startDelay: 1000
  },
  timeout: 30000
}

/**
 *  WebSocket handler class adding numerous features to the standard WebSocket.
 */
export default class Socket<In = string, Out = any> {
  #abortListener?: () => void
  #binary: BinaryType
  #closeCall = false
  #closeCallback: SocketCallback<CloseEvent> = noop
  #connected?: boolean
  #controller?: AbortController
  #dataCallback?: SocketCallback<MessageEvent<In>>
  #disconnectCall = false
  readonly #emitter: Emitter<Record<SocketEvent, SocketEventData<In>>>
  #errCallback: SocketCallback<ErrorEvent> = noop
  #heartBeatRunning = false
  #inBuffer: MessageEvent<In>[]
  #msgCallback: SocketCallback<MessageEvent<In>> = noop
  #openCallback: SocketCallback<Event> = noop
  readonly #opts: SocketConfig
  #outBuffer: Out[]
  #parser: (data: Out) => OutData = stringify
  #paused = false
  #pingStart = false
  #prevTimeStamp = 0
  #prevUrl?: string | URL
  readonly #protocols?: string | string[]
  #retries: number
  #retryCall = false
  #timers: Timers = {}
  #upTime = 0
  readonly #urlProvider: UrlProvider
  #ws?: WebSocket

  constructor(provider: UrlProvider, options: DeepPartial<SocketConfig> = {}) {
    this.#urlProvider = provider
    this.#protocols = options.protocol
    this.#emitter = mitt()
    this.#retries = 0
    this.#inBuffer = []
    this.#outBuffer = []
    this.#opts = deepMergeObj(DefaultOptions, options)
    this.#binary = this.#opts.binary

    // Initiate callbacks
    this.onOpen(noop)
    this.onData(noop)
    this.onError(noop)
    this.onClose(noop)

    if (this.#opts.immediate) this.connect()
  }

  /**
   *  Cleans up all buffers and timers.
   */
  private cleanup(): void {
    this.flushTimers()
    if (this.#retryCall) this.#retryCall = false
    else {
      this.#outBuffer = []
      this.#inBuffer = []
      this.#retries = 0
    }
  }

  /**
   *  Clears up a specific stored and running timer.
   *
   *  @param timer - name of the timer to clear.
   */
  private clearTimer(timer: keyof Timers): void {
    if (this.#timers[timer]) {
      clearTimeout(this.#timers[timer])
      this.#timers[timer] = undefined
    }
  }

  /**
   *  Clears all stored timers, whether running or not.
   */
  private flushTimers(): void {
    for (const timer of keysOf(this.#timers)) {
      this.clearTimer(timer)
    }
  }

  /**
   *  Resolves the URL from the given url provider.
   *
   *  @returns the resolved url.
   */
  private provideUrl(): string | URL {
    const url = this.#urlProvider
    return (this.#prevUrl = isString(url) || url instanceof URL ? url : url(this.#retries, this.#prevUrl))
  }

  /**
   *  Guard function indicating whether to reconnect on WebSocket closure.
   *
   * @returns - `true`, if suitable for a reconnect, otherwise `false`.
   */
  private shouldReconnect(): boolean {
    const retryOpts = this.#opts.retry
    return !this.#disconnectCall && !isEmptyObj(retryOpts) && this.#retries < retryOpts.amount && this.uptime >= retryOpts.minUpTime
  }

  /**
   *  Starts the keep alive timer.
   */
  private startKATimer(): void {
    this.clearTimer('keepAlive')
    if (this.#opts.timeout > 0) {
      this.#timers.keepAlive = setTimeout(() => {
        this.disconnect()
        this.connect()
      }, this.#opts.timeout)
    }
  }

  /**
   *  Releases buffers and performs post install cleanup.
   */
  private sync(): void {
    // Update outBuffer by sending empty data
    this.syncInBuffer()
    this.syncOutBuffer()
    this.#retryCall = false
    this.#prevTimeStamp = Date.now()
  }

  /**
   *  Syncs the incoming messages buffer with the current WebSocket runtime.
   */
  private syncInBuffer(): void {
    const bufferOpts = this.#opts.buffer
    const inBuffer = this.#inBuffer
    if (bufferOpts && inBuffer.length && inBuffer.length > bufferOpts.min) {
      for (const bufferedEvents of inBuffer) {
        this.#emitter.emit('data', bufferedEvents)
        this.#dataCallback!(bufferedEvents)
      }
      this.#inBuffer = []
    }
  }

  /**
   *  Sync the outgoing data buffer with the current WebSocket runtime.
   */
  private syncOutBuffer(): void {
    if (!this.#ws) return
    const bufferOpts = this.#opts.buffer
    const buffer = this.#outBuffer
    if (bufferOpts && buffer.length && buffer.length >= bufferOpts.min) {
      for (let i = 0, max = min(bufferOpts.max, buffer.length); i < max; i++) {
        this.#ws.send(this.#parser(buffer[i]))
        this.#emitter.emit('send')
      }
      this.#outBuffer = []
    }
  }

  /**
   *  Updates the current uptime.
   *
   *  @returns - the next timestamp to store.
   */
  private timestamp(): number {
    const next = Date.now()
    this.#upTime += next - this.#prevTimeStamp
    return next
  }

  /**
   *  Forces the WebSocket to close and disconnect, due to an error.
   *
   *  @param reason - the reason for the forced closure.
   */
  abort(reason?: string | Error): void {
    this.#controller?.abort(reason)
    if (this.#opts.retry.onAbort) this.reconnect()
    else {
      const errorAbort = isError(reason)
      this.#emitter.emit(errorAbort ? 'error' : 'abort', errorAbort ? reason : new Error(reason))
    }
  }

  /**
   *  Connects the WebSocket to the server of the given URL.
   */
  connect(): void {
    if (this.#ws) this.disconnect()
    this.#emitter.emit('preConnect')

    try {
      const ws = (this.#ws = new WebSocket(this.provideUrl(), this.#protocols))
      this.#controller = new AbortController()

      this.#abortListener = (): void => {
        ws.close()
      }
      this.#controller.signal.addEventListener('abort', this.#abortListener)

      ws.onopen = this.#openCallback
      ws.onclose = this.#closeCallback
      ws.onerror = this.#errCallback as SocketCallback<Event>
      ws.onmessage = this.#msgCallback
      ws.binaryType = this.#binary

      this.#closeCall = false
      this.#disconnectCall = false
    } catch (err) {
      this.abort(new Error(`Error when trying to connect to server: ${(err as Error).message}`))
    }
  }

  /**
   *  Disconnects the running WebSocket connection.
   */
  disconnect(): void {
    if (!this.#ws) return
    this.#disconnectCall = true
    this.#connected = false
    this.#ws.close()
    this.#ws = undefined
    if (this.#controller && this.#abortListener) {
      this.#controller.signal.removeEventListener('abort', this.#abortListener)
      this.#controller = undefined
    }
    this.cleanup()
  }

  /**
   *  Clears an event listener.
   *
   *  @param event - the targeted lifecycle event.
   *  @param handler - the handler function reference to clean up.
   */
  off(event: SocketEvent, handler: Handler<SocketEventData<In>>): void {
    this.#emitter.off(event, handler)
  }

  /**
   *  Adds an event listener to a lifecycle event of the WebSocket.
   *
   *  @param event - the targeted lifecycle event.
   *  @param handler - the handler function reference to attach.
   */
  on(event: 'data', handler: Handler<MessageEvent<In>>): void
  on(event: 'error' | 'abort', handler: Handler<Error>): void
  on(event: 'close', handler: Handler<CloseEvent>): void
  on(event: 'preConnect' | 'open' | 'send' | 'reconnect', handler: Handler<undefined>): void
  on(event: SocketEvent, handler: Handler<SocketEventData<In>>): void
  on(event: SocketEvent, handler: Handler<any>): void {
    this.#emitter.on(event, handler)
  }

  /**
   *  Default, central handler for defining the behavior on the closure of the WebSocket.
   *
   *  @param callback - the default callback to handle the closing event.
   */
  onClose(callback: SocketCallback<CloseEvent>): void {
    this.#closeCallback = (event: CloseEvent): void => {
      if (this.#closeCall) return
      this.#closeCall = true
      this.clearTimer('keepAlive')
      this.#emitter.emit('close', event)
      callback(event)
      if (this.shouldReconnect()) this.reconnect()
      this.#connected = false
    }
  }

  /**
   *  Default, central handler for defining the behavior when receiving messages from the server.
   *
   *  @param callback - the default callback to handle on receiving messages.
   */
  onData(callback: SocketCallback<MessageEvent<In>>): void {
    const bufferOpts = this.#opts.buffer
    const inBuffer = this.#inBuffer
    this.#dataCallback = callback
    this.#msgCallback = (event: MessageEvent): void => {
      try {
        if (!this.#paused) {
          this.#emitter.emit('data', event)
          if (this.#pingStart || (this.#heartBeatRunning && event.data === PongContent)) {
            this.#emitter.emit('pong')
            this.clearTimer('ping')
            this.#pingStart = false
          }
          this.syncInBuffer()
          callback(event)
        } else if (isObj(bufferOpts) && inBuffer.length < bufferOpts.max) inBuffer.push(event)
      } catch (err) {
        this.abort(new Error(`Error receiving data: ${(err as Error).message}`))
      }
    }
  }

  /**
   *  Default, central handler for defining the behavior when encountering a server or websocket error.
   *
   *  @param callback - the default callback to handle on error.
   */
  onError(callback: SocketCallback<ErrorEvent>): void {
    this.#errCallback = (event: ErrorEvent): void => {
      this.clearTimer('keepAlive')
      this.#emitter.emit('error', event.error)
      callback(event)
      if (this.shouldReconnect()) this.reconnect()
    }
  }

  /**
   *  Default, central handler for defining the behavior when the WebSocket successfully connected with the server.
   *
   *  @param callback - the default callback on connection success.
   */
  onOpen(callback: SocketCallback<Event>): void {
    this.#openCallback = (event: Event): void => {
      this.#connected = true
      this.startKATimer()
      this.#emitter.emit('open')
      callback(event)
      this.sync()
    }
  }

  /**
   *  Pauses the WebSocket. It remains open, but refuses to do anything, buffering incoming and outgoing messages until it is resumed.
   */
  pause(): void {
    this.#paused = true
    this.clearTimer('ping')
    this.clearTimer('heartbeat')
  }

  /**
   *  Pings the connected server. It will send a message in form of `'{"type":"ping"}'` and expects in return a message in form of `'{"type":"pong"}'`
   */
  ping(): void {
    this.clearTimer('ping')
    if (this.active && this.#ws) {
      this.#pingStart = true
      this.#emitter.emit('ping')
      this.#ws.send(PingContent)
      this.#timers.ping = setTimeout(() => {
        if (this.#opts.ping.strict) this.abort('Error: No response received on ping.')
        else this.disconnect()
      }, this.#opts.ping.timeout)
    }
  }

  /**
   *  Manually reconnects the WebSocket to the server.
   */
  reconnect(): void {
    const retry = this.#opts.retry
    if (this.#timers.retry || this.#retries >= retry.amount) return

    this.clearTimer('retry')

    this.#retries++
    this.#retryCall = true
    this.#timers.retry = setTimeout(() => {
      this.#emitter.emit('reconnect')
      if (!this.#ws || this.#ws.readyState === WebSocket.CLOSED) this.connect()
      else {
        this.disconnect()
        this.connect()
      }
      this.#retryCall = false
    }, min(retry.startDelay * ((this.#retries + 1) * retry.delayFactor), retry.maxDelay))
  }

  /**
   *  Resumes the paused WebSocket and releases buffered contents.
   */
  resume(): void {
    if (this.#paused) this.sync()
    this.#paused = false
  }

  /**
   *  Parses data and sends it to the server.
   *
   *  @param data - the data to send.
   *  @param parser - The parser to prepare the data before sending it to the server. Default: `JSON.stringify`
   */
  send(data: Out, parser: (data: Out) => OutData = stringify): void {
    const bufferOpts = this.#opts.buffer
    const buffer = this.#outBuffer
    if (this.#ws?.readyState === WebSocket.OPEN && !this.#paused) {
      this.#parser = parser
      try {
        this.syncOutBuffer()
        if (data) {
          this.#ws.send(parser(data))
          this.#emitter.emit('send')
        }
      } catch (err) {
        this.abort(new Error(`Error sending message: ${(err as Error).message}`))
      }
    } else if (data && isObj(bufferOpts) && buffer.length < bufferOpts.max) buffer.push(data)
  }

  /**
   *  Starts a heartbeat process to repeatedly check for server activity and to remain connected.
   */
  startBeat(): void {
    if (this.active && this.#ws && !this.#pingStart) {
      this.#heartBeatRunning = true
      this.clearTimer('heartbeat')

      const sendPing = (): void => {
        this.#emitter.emit('ping')
        this.#ws!.send(PingContent)
        this.#timers.ping = setTimeout(() => {
          this.disconnect()
          this.connect()
          this.startBeat()
        }, this.#opts.ping.timeout)
      }

      this.#timers.heartbeat = setInterval(sendPing, this.#opts.ping.heartbeat)
      sendPing()
    }
  }

  /**
   *  Stops the started heartbeat process.
   */
  stopBeat(): void {
    this.clearTimer('heartbeat')
    this.#heartBeatRunning = false
  }

  /**
   *  Returns a flag indicating whether the WebSocket is up and running.
   */
  get active(): boolean {
    return !!this.#connected && !this.#paused
  }

  /**
   *  Returns a flag indicating whether the WebSocket is in a heartbeat process.
   */
  get beating(): boolean {
    return this.#heartBeatRunning
  }

  /**
   *  Returns the used binary type of the WebSocket messaging.
   */
  get binary(): BinaryType {
    return this.#binary
  }

  set binary(type: BinaryType) {
    this.#binary = type
    if (this.#ws) this.#ws.binaryType = type
  }

  /**
   *  Returns the buffered amount of data that is yet to be send through the network.
   */
  get bufferedAmount(): number {
    let size = 0
    for (const data of this.#outBuffer) {
      if (isString(data)) size += data.length
      else if (data instanceof Blob) size += data.size
      else if (ArrayBuffer.isView(data)) size += data.byteLength
      else size += (data as any).toString().length
    }
    return this.#ws?.bufferedAmount ?? size
  }

  /**
   *  Returns the extensions selected by the server, if any.
   */
  get extensions(): string {
    return this.#ws?.extensions ?? ''
  }

  /**
   *  Returns a flag indicating whether the WebSocket is paused.
   */
  get paused(): boolean {
    return this.#paused
  }

  /**
   *  Returns the subprotocol selected by the server, if any. It can be used in conjunction
   *  with the array form of the constructor's second argument to perform subprotocol negotiation.
   */
  get protocol(): string {
    return this.#ws?.protocol ?? ''
  }

  /**
   *  Returns the state of the WebSocket object's connection. It can have the values described below.
   */
  get readyState(): number {
    return this.#ws?.readyState ?? WebSocket.CLOSED
  }

  /**
   *  Returns the amount of reconnectsions the WebSocket has went through.
   */
  get retries(): number {
    return this.#retries
  }

  /**
   *  Returns the total uptime of the WebSocket, not including the time it was paused.
   */
  get uptime(): number {
    if (this.active) {
      this.#prevTimeStamp = this.timestamp()
    }
    return this.#upTime
  }

  /**
   *  Returns the URL that was used to establish the WebSocket connection.
   */
  get url(): string {
    return this.#ws?.url ?? ''
  }
}
