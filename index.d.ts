import { type Handler } from 'mitt'
import type { DeepPartial, TypedArray } from 'typestar'

declare module 'sockolate' {
  /*  The type of data the WebSocket can send out to the server. */
  export type OutData = string | TypedArray | ArrayBufferLike | Blob | ArrayBufferView
  /*  The callback type used for the central default event handlers. */
  export type SocketCallback<T extends Event> = (event: T) => void
  /*  The different lifecycles of the WebSocket for event handling. */
  export type SocketEvent = 'preConnect' | 'open' | 'data' | 'send' | 'close' | 'error' | 'abort' | 'reconnect' | 'ping' | 'pong'
  /* The type of data a `SocketEvent` can hold. */
  export type SocketEventData<In> = undefined | Error | CloseEvent | MessageEvent<In>
  /* A static or dynamic URL provider function or string that indicates what URL to use for each retry. */
  export type UrlProvider = string | URL | ((retry: number, prevUrl?: string | URL) => string | URL)
  /**
   *  Interface defining the behavior of the in and out buffers.
   */
  export interface BufferConfig {
    /**
     *  The maximum capacity of each buffer
     *
     *  @defaultValue `32`
     */
    max: number
    /**
     *  The minimum size of the buffer before it can be released.
     *
     *  @defaultValue `0`
     */
    min: number
  }
  /**
   *  Interface defining the behavior during a ping.
   */
  export interface PingConfig {
    /**
     *  The duration of each heart beat in ms.
     *
     *  @defaultValue `5000`
     */
    heartbeat: number
    /**
     *  Flag indicating whether to throw an error and abort the socket.
     *
     *  @defaultValue `true`
     */
    strict: boolean
    /**
     *  The maximum time span in where to expect the pong from the server in ms.
     *
     *  @defaultValue `5000`
     */
    timeout: number
  }
  /**
   *  Interface defining the behavior during a reconnection.
   */
  export interface RetryConfig {
    /**
     *  The amount of reconnects before the final disconnect.
     *
     *  @defaultValue: `0`
     */
    amount: number
    /**
     *  The delay increase between each reconnect attempt.
     *
     *  @defaultValue `1.5`
     */
    delayFactor: number
    /**
     *  The maximum delay for a reconnect attempt in ms.
     *
     *  @defaultValue `30000`
     */
    maxDelay: number
    /**
     *  The minimum accumulated connection time before a reconnect should be attempted in ms.
     *
     *  @defaultValue `500`
     */
    minUpTime: number
    /**
     *  Flag indicating whether to try a reconnect on abort.
     *
     *  @defaultValue `false`
     */
    onAbort: boolean
    /**
     *  The initial time to wait before trying to reconnect in ms.
     *
     *  @defaultValue `1000`
     */
    startDelay: number
  }
  /**
   *  Configuration interface to configure the behavior of the WebSocket or its features.
   */
  export interface SocketConfig {
    /**
     *  The used binary type of the WebSocket.
     *
     *  @defaultValue `blob`
     */
    binary: BinaryType
    /* Either a flag indicating whether to buffer or the behavior of the buffer. The Socket buffers by default. */
    buffer: false | BufferConfig
    /**
     *  Flag indicating whether to connect the WebSocket on creation.
     *
     *  @defaultValue `false`
     */
    immediate: boolean
    /* Configuration for the ping process. */
    ping: PingConfig
    /* Protocols to use for the connection. */
    protocol?: string | string[]
    /*  Configuration for a reconnect. */
    retry: RetryConfig
    /**
     *  The amount of time in where to timeout the WebSocket for inactivity in ms.
     *
     *  @defaultValue `30000`
     */
    timeout: number
  }
  /**
   *  WebSocket handler class adding numerous features to the standard WebSocket.
   */
  export default class Socket<In = string, Out = any> {
    constructor(provider: UrlProvider, options?: DeepPartial<SocketConfig>)
    /**
     *  Forces the WebSocket to close and disconnect, due to an error.
     *  Sends an abort signal to the server that can be loaded with extra payload.
     *
     *  @param reason - the reason for the forced closure.
     *  @param payload - the extra data to send as server connection closure handling.
     */
    abort(reason?: string | Error, payload?: Out): void
    /**
     *  Connects the WebSocket to the server of the given URL.
     */
    connect(): void
    /**
     *  Disconnects the running WebSocket connection.
     */
    disconnect(): void
    /**
     *  Clears an event listener.
     *
     *  @param event - the targeted lifecycle event.
     *  @param handler - the handler function reference to clean up.
     */
    off(event: SocketEvent, handler: Handler<SocketEventData<In>>): void
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
    on(event: SocketEvent, handler: Handler<any>): void
    /**
     *  Default, central handler for defining the behavior on the closure of the WebSocket.
     *
     *  @param callback - the default callback to handle the closing event.
     */
    onClose(callback: SocketCallback<CloseEvent>): void
    /**
     *  Default, central handler for defining the behavior when receiving messages from the server.
     *
     *  @param callback - the default callback to handle on receiving messages.
     */
    onData(callback: SocketCallback<MessageEvent<In>>): void
    /**
     *  Default, central handler for defining the behavior when encountering a server or websocket error.
     *
     *  @param callback - the default callback to handle on error.
     */
    onError(callback: SocketCallback<ErrorEvent>): void
    /**
     *  Default, central handler for defining the behavior when the WebSocket successfully connected with the server.
     *
     *  @param callback - the default callback on connection success.
     */
    onOpen(callback: SocketCallback<Event>): void
    /**
     *  Pauses the WebSocket. It remains open, but refuses to do anything, buffering incoming and outgoing messages until it is resumed.
     */
    pause(): void
    /**
     *  Pings the connected server. It will send a message in form of `'{"type":"ping"}'` and expects in return a message in form of `'{"type":"pong"}'`
     */
    ping(): void
    /**
     *  Manually reconnects the WebSocket to the server.
     */
    reconnect(): void
    /**
     *  Resumes the paused WebSocket and releases buffered contents.
     */
    resume(): void
    /**
     *  Parses data and sends it to the server.
     *
     *  @param data - the data to send.
     *  @param parser - The parser to prepare the data before sending it to the server. Default: `JSON.stringify`
     */
    send(data: Out, parser?: (data: Out) => OutData): void
    /**
     *  Starts a heartbeat process to repeatedly check for server activity and to remain connected.
     */
    startBeat(): void
    /**
     *  Stops the started heartbeat process.
     */
    stopBeat(): void
    /**
     *  Returns a flag indicating whether the WebSocket is up and running.
     */
    get active(): boolean
    /**
     *  Returns a flag indicating whether the WebSocket is in a heartbeat process.
     */
    get beating(): boolean
    /**
     *  Returns the used binary type of the WebSocket messaging.
     */
    get binary(): BinaryType
    set binary(type: BinaryType)
    /**
     *  Returns the buffered amount of data that is yet to be send through the network.
     */
    get bufferedAmount(): number
    /**
     *  Returns the extensions selected by the server, if any.
     */
    get extensions(): string
    /**
     *  Returns a flag indicating whether the WebSocket is paused.
     */
    get paused(): boolean
    /**
     *  Returns the subprotocol selected by the server, if any. It can be used in conjunction
     *  with the array form of the constructor's second argument to perform subprotocol negotiation.
     */
    get protocol(): string
    /**
     *  Returns the state of the WebSocket object's connection. It can have the values described below.
     */
    get readyState(): number
    /**
     *  Returns the amount of reconnections the WebSocket has went through.
     */
    get retries(): number
    /**
     *  Returns the total uptime of the WebSocket, not including the time it was paused.
     */
    get uptime(): number
    /**
     *  Returns the URL that was used to establish the WebSocket connection.
     */
    get url(): string
  }
}
