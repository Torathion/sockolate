import type { RetryConfig } from 'src/interfaces'
import type { SocketEvent, UrlProvider } from 'src/types'
import { min, parseJson, stringify } from 'compresso'
import { type Client, Server } from 'mock-socket'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Socket from '../src'

const PORT = 50123
const URL = `ws://localhost:${PORT}/`

function calcRetry(retry: number, retryOptions: Omit<RetryConfig, 'onAbort'>): number {
  return min(retryOptions.startDelay * (retry * retryOptions.delayFactor), retryOptions.maxDelay)
}

function setupBufferTest(localSocket: Socket, server: Server, inBuf: string[], outBuf: string[]): void {
  localSocket.onData(event => {
    inBuf.push(event.data)
  })

  server.on('connection', socket => {
    socket.on('message', data => {
      outBuf.push(data as string)
      socket.send(`Server: ${data as string}`)
    })

    socket.send('server1')
    socket.send('server2')
  })
}

function setupServerPingPong(server: Server): void {
  server.on('connection', socket => {
    socket.on('message', data => {
      if (data === '{"type":"ping"}') socket.send('{"type":"pong"}')
    })
  })
}

function updateTime(now: number, amount: number): void {
  vi.setSystemTime(now + amount)
}

async function waitForConnection(socket: Socket): Promise<void> {
  socket.connect()
  await waitForSocketEvent(socket, 'open')
}

async function waitForReconnect(retry: number, retryOptions: Omit<RetryConfig, 'onAbort'>): Promise<void> {
  await vi.advanceTimersByTimeAsync(calcRetry(retry, retryOptions))
}

async function waitForSocketEvent<T>(socket: Socket, event: SocketEvent): Promise<T> {
  return new Promise<T>(resolve => {
    socket.on(event, data => {
      resolve(data as T)
    })
  })
}

const DefaultRetryOptions: Omit<RetryConfig, 'onAbort'> = { amount: 1, delayFactor: 1, maxDelay: 100, minUpTime: 0, startDelay: 100 }

describe('Socket', () => {
  let server: Server

  beforeEach(() => {
    server = new Server(URL)
    server.on('connection', socket => {
      socket.on('close', () => {
        socket.close()
      })
    })

    vi.useFakeTimers()
  })

  afterEach(() => {
    server.close()
    vi.useRealTimers()
  })

  it('defaults getters when not ready', () => {
    const ws = new Socket(URL)

    expect(ws.bufferedAmount).toBe(0)
    expect(ws.protocol).toBe('')
    expect(ws.url).toBe('')
    expect(ws.extensions).toBe('')
    expect(ws.binary).toBe('blob')
    expect(ws.readyState).toBe(WebSocket.CLOSED)
    expect(ws.uptime).toBe(0)
  })

  it('can update websocket metadata', () => {
    const socket = new Socket(URL)

    expect(socket.binary).toBe('blob')
    socket.binary = 'arraybuffer'

    expect(socket.binary).toBe('arraybuffer')
  })

  describe('Connection', () => {
    it('can be opened and closed', async () => {
      const socket = new Socket(URL, { protocol: 'any-protocol' })

      socket.on('open', () => {
        expect(socket.url).toBe(URL)
        expect(socket.protocol).toBe('any-protocol')
        socket.disconnect()
      })

      socket.connect()

      await waitForSocketEvent(socket, 'close')
      expect(socket.readyState).toBe(WebSocket.CLOSED)
    })

    it('can be immediately opened', async () => {
      const socket = new Socket(URL, { immediate: true })
      await waitForSocketEvent(socket, 'open')

      expect(socket.readyState).toBe(WebSocket.OPEN)

      socket.disconnect()
    })

    it('does nothing when trying to disconnect a disconnected socket', () => {
      const socket = new Socket(URL)
      socket.disconnect()
      expect(socket.readyState).toBe(WebSocket.CLOSED)
    })

    it('holds close metadata about the connection closure', async () => {
      const socket = new Socket(URL)
      let closeData: CloseEvent | undefined

      socket.on('close', event => {
        closeData = event
      })

      await waitForConnection(socket)
      server.close({ code: 1000, reason: 'Normal closure', wasClean: true })

      expect(closeData!.code).toBe(1000)
      expect(closeData!.reason).toBe('Normal closure')
      expect(closeData!.wasClean).toBe(true)
    })

    it('can send and receive data', async () => {
      const localSocket = new Socket(URL)

      server.on('connection', socket => {
        socket.on('message', data => {
          socket.send(`Echo: ${data as any}`)
        })
      })

      await waitForConnection(localSocket)
      localSocket.send('test')

      const data = await waitForSocketEvent<MessageEvent>(localSocket, 'data')
      expect(data.data).toBe('Echo: "test"')
      localSocket.disconnect()
    })

    it('can change the binary type of an open socket', async () => {
      const socket = new Socket(URL)
      await waitForConnection(socket)
      socket.binary = 'arraybuffer'

      expect(socket.binary).toBe('arraybuffer')

      socket.disconnect()
    })

    it('has live metadata', async () => {
      const socket = new Socket(URL)
      await waitForConnection(socket)

      expect(socket.bufferedAmount).toBe(0)
      expect(socket.extensions).toBe('')
      expect(socket.protocol).toBe('')
      expect(socket.readyState).toBe(WebSocket.OPEN)
      expect(socket.uptime).toBeGreaterThan(0)
      expect(socket.active).toBe(true)
      expect(socket.paused).toBe(false)
      expect(socket.beating).toBe(false)

      socket.disconnect()
    })

    it('does not increase uptime when paused or disconnected', async () => {
      const baseTime = Date.now()
      const socket = new Socket(URL)

      expect(socket.uptime).toBe(0)

      let time = 0
      await waitForConnection(socket)

      updateTime(baseTime, (time += 1000))
      expect(socket.uptime).closeTo(1000, 10)

      socket.pause()

      updateTime(baseTime, (time += 3000))
      expect(socket.uptime).closeTo(1000, 10)

      socket.resume()

      updateTime(baseTime, (time += 3000))
      expect(socket.uptime).closeTo(4000, 10)
      updateTime(baseTime, (time += 50))
      expect(socket.uptime).closeTo(4050, 10)

      socket.disconnect()
      updateTime(baseTime, (time += 10000))
      expect(socket.uptime).closeTo(4050, 10)
    })
  })

  describe('Ping', () => {
    it('sends a ping and receives a pong', async () => {
      const localSocket = new Socket(URL, { ping: { timeout: 2000 } })
      setupServerPingPong(server)

      let pongCounter = 0
      let pingCounter = 0

      localSocket.on('pong', () => {
        pongCounter++
      })

      localSocket.on('ping', () => {
        pingCounter++
      })

      await waitForConnection(localSocket)
      localSocket.ping()
      await vi.advanceTimersByTimeAsync(4000)

      expect(pongCounter).toBe(1)
      expect(pingCounter).toBe(1)
    })

    it('sends a ping and timeouts when no response has been received', async () => {
      const socket = new Socket(URL, { ping: { strict: false, timeout: 2000 } })
      await waitForConnection(socket)
      let pingCounter = 0
      socket.on('ping', () => {
        pingCounter++
      })
      socket.ping()

      await vi.advanceTimersByTimeAsync(2000)

      expect(socket.readyState).toBe(WebSocket.CLOSED)
      expect(pingCounter).toBe(1)
    })

    it('aborts on strict ping mode', async () => {
      const socket = new Socket(URL, { ping: { timeout: 2000 } })
      await waitForConnection(socket)
      let pingCounter = 0
      let errorData: Error | undefined
      socket.on('ping', () => {
        pingCounter++
      })

      socket.on('abort', error => {
        errorData = error
      })

      socket.ping()

      await vi.advanceTimersByTimeAsync(2000)

      expect(pingCounter).toBe(1)
      expect(errorData).toBeInstanceOf(Error)
      expect(errorData!.message).toContain('No response received on ping.')
    })

    it('does not ping when disconnected', () => {
      const socket = new Socket(URL)
      let pingCounter = 0
      socket.on('ping', () => {
        pingCounter++
      })
      socket.ping()
      expect(pingCounter).toBe(0)
    })

    it('does not ping when paused', async () => {
      const socket = new Socket(URL)
      await waitForConnection(socket)

      let pingCounter = 0
      socket.on('ping', () => {
        pingCounter++
      })
      socket.pause()
      socket.ping()

      expect(pingCounter).toBe(0)

      socket.resume()
      socket.ping()
      expect(pingCounter).toBe(1)
    })
  })

  describe('Heartbeat', () => {
    it('pings at heartbeat interval and clears on pong', async () => {
      const localSocket = new Socket(URL, { ping: { timeout: 2000, heartbeat: 2000 } })
      setupServerPingPong(server)

      let pongCounter = 0
      let pingCounter = 0

      localSocket.on('pong', () => {
        pongCounter++
      })

      localSocket.on('ping', () => {
        pingCounter++
      })

      await waitForConnection(localSocket)
      localSocket.startBeat()

      await vi.advanceTimersByTimeAsync(4000)

      expect(pingCounter).toBe(3)
      expect(pongCounter).toBe(2)

      localSocket.stopBeat()
    })

    it('does not start when inactive or during a ping', async () => {
      const socket = new Socket(URL, { ping: { timeout: 2000, heartbeat: 1000 } })
      setupServerPingPong(server)

      socket.startBeat()
      expect(vi.getTimerCount()).toBe(0)

      await waitForConnection(socket)
      socket.ping()
      socket.startBeat()
      socket.stopBeat()
      expect(true).toBe(true)
    })
  })

  describe('Retries', () => {
    it('retries connection on failure', async () => {
      const socket = new Socket(URL, {
        retry: DefaultRetryOptions
      })

      let retryCounter = 0
      let preConnectCounter = 0

      const countRetry = (): number => retryCounter++
      const preConnect = (): number => preConnectCounter++

      socket.on('reconnect', countRetry)
      socket.on('preConnect', preConnect)

      server.close()
      socket.connect()

      await waitForSocketEvent(socket, 'error')
      await waitForReconnect(1, DefaultRetryOptions)

      expect(retryCounter).toBe(1)
      expect(preConnectCounter).toBe(2)

      socket.off('reconnect', countRetry)
      socket.off('preConnect', preConnect)
    })

    it('prevents reconnect attempt spams', async () => {
      const socket = new Socket(URL, { retry: DefaultRetryOptions })

      for (let i = 0; i < 100; i++) socket.reconnect()

      await waitForReconnect(1, DefaultRetryOptions)

      expect(socket.retries).toBe(1)
      socket.disconnect()
    })

    it('closes if the max amount of retries are met', async () => {
      const socket = new Socket(URL, { retry: DefaultRetryOptions })
      let closeCount = 0

      socket.on('close', () => {
        closeCount++
      })

      await waitForConnection(socket)
      server.close()
      await waitForSocketEvent(socket, 'close')
      await waitForReconnect(1, DefaultRetryOptions)

      expect(closeCount).toBe(2)
      expect(socket.retries).toBe(1)
    })

    it('can retry after abortion', async () => {
      const socket = new Socket(URL, { retry: { ...DefaultRetryOptions, onAbort: true } })
      let reconnectCount = 0

      socket.on('reconnect', () => {
        reconnectCount++
      })

      await waitForConnection(socket)
      socket.abort('Test abort')
      await waitForReconnect(1, DefaultRetryOptions)

      expect(reconnectCount).toBe(1)
    })

    it('can provide a url for each retry', async () => {
      /* eslint-disable unicorn/consistent-function-scoping */
      const retryOpts = { ...DefaultRetryOptions, amount: 3 }
      const provider: UrlProvider = (retry: number) => `ws://localhost:${PORT + retry + 1}/`
      /* eslint-enable unicorn/consistent-function-scoping */
      const socket = new Socket(provider, { retry: retryOpts })
      socket.connect()

      await waitForReconnect(1, retryOpts)
      await waitForReconnect(2, retryOpts)
      await waitForReconnect(3, retryOpts)

      expect(socket.retries).toBe(3)
    })
  })

  describe('Buffering', () => {
    it('buffers messages when paused', async () => {
      const localSocket = new Socket<string>(URL, { buffer: { max: 2 } })
      const recMessages: string[] = []
      const sentMessages: string[] = []
      setupBufferTest(localSocket, server, recMessages, sentMessages)

      await waitForConnection(localSocket)
      await vi.advanceTimersByTimeAsync(100)

      expect(recMessages).toEqual(['server1', 'server2'])

      localSocket.pause()
      localSocket.send('msg1')
      localSocket.send('msg2')
      localSocket.send('msg3')

      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages.length).toBe(0)
      expect(recMessages).toEqual(['server1', 'server2'])

      localSocket.resume()
      localSocket.send('msg4')
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages).toEqual(['"msg1"', '"msg2"', '"msg4"'])
      expect(recMessages).toEqual(['server1', 'server2', 'Server: "msg1"', 'Server: "msg2"', 'Server: "msg4"'])

      localSocket.send('msg5')
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages).toEqual(['"msg1"', '"msg2"', '"msg4"', '"msg5"'])
      expect(recMessages).toEqual(['server1', 'server2', 'Server: "msg1"', 'Server: "msg2"', 'Server: "msg4"', 'Server: "msg5"'])
    })

    it('allows to not buffer messages when paused', async () => {
      const localSocket = new Socket<string>(URL, { buffer: false })
      const receivedMessages: string[] = []
      const sentMessages: string[] = []
      setupBufferTest(localSocket, server, receivedMessages, sentMessages)

      await waitForConnection(localSocket)
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages).toEqual([])
      expect(receivedMessages).toEqual(['server1', 'server2'])

      localSocket.pause()
      localSocket.send('msg1')
      localSocket.send('msg2')
      localSocket.send('msg3')

      await vi.advanceTimersByTimeAsync(100)
      localSocket.resume()
      localSocket.send('msg4')
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages).toEqual(['"msg4"'])
      expect(receivedMessages).toEqual(['server1', 'server2', 'Server: "msg4"'])
    })

    it('only releases the buffer after a certain threshold', async () => {
      const localSocket = new Socket<string>(URL, { buffer: { max: 4, min: 3 } })
      const receivedMessages: string[] = []
      const sentMessages: string[] = []
      setupBufferTest(localSocket, server, receivedMessages, sentMessages)

      await waitForConnection(localSocket)
      await vi.advanceTimersByTimeAsync(100)

      localSocket.pause()
      localSocket.send('msg1')
      localSocket.send('msg2')

      await vi.advanceTimersByTimeAsync(100)
      localSocket.resume()

      expect(receivedMessages).toEqual(['server1', 'server2'])
      expect(sentMessages).toEqual([])

      localSocket.pause()

      localSocket.send('msg3')
      localSocket.send('msg4')
      localSocket.send('msg5')
      await vi.advanceTimersByTimeAsync(100)

      localSocket.resume()
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages).toEqual(['"msg1"', '"msg2"', '"msg3"', '"msg4"'])
      expect(receivedMessages).toEqual(['server1', 'server2', 'Server: "msg1"', 'Server: "msg2"', 'Server: "msg3"', 'Server: "msg4"'])
    })

    it('only buffers to a certain maximum capacity', async () => {
      const localSocket = new Socket<string>(URL, { buffer: { max: 10 } })
      const receivedMessages: string[] = []
      const sentMessages: string[] = []
      let serverSocket: Client | undefined

      localSocket.onData(event => {
        receivedMessages.push(event.data)
      })

      server.on('connection', socket => {
        socket.on('message', data => {
          sentMessages.push(data as string)
        })

        serverSocket = socket
      })

      await waitForConnection(localSocket)
      localSocket.pause()
      for (let i = 0; i < 100; i++) {
        serverSocket!.send(`${i}`)
        localSocket.send(`${i}`)
      }
      await vi.advanceTimersByTimeAsync(100)

      localSocket.resume()
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages.length).toBe(10)
      expect(receivedMessages.length).toBe(10)
    })

    it('buffers data before the connection opened', async () => {
      const socket = new Socket<string>(URL)
      const receivedMessages: string[] = []
      const sentMessages: string[] = []
      setupBufferTest(socket, server, receivedMessages, sentMessages)

      for (let i = 0; i < 10; i++) socket.send(i.toString())

      await waitForConnection(socket)
      await vi.advanceTimersByTimeAsync(100)

      expect(sentMessages.length).toBe(10)
      expect(receivedMessages.length).toBe(12)
    })

    it('buffers data when reconnecting', async () => {
      const retryOptions: Omit<RetryConfig, 'onAbort'> = {
        amount: 2,
        delayFactor: 1,
        maxDelay: 100,
        minUpTime: 0,
        startDelay: 100
      }

      const socket = new Socket<string>(URL, { buffer: { max: 4 }, retry: retryOptions })
      const receivedMessages: string[] = []
      const sentMessages: string[] = []
      setupBufferTest(socket, server, receivedMessages, sentMessages)

      await waitForConnection(socket)
      await vi.advanceTimersByTimeAsync(100)

      expect(receivedMessages).toEqual(['server1', 'server2'])
      expect(sentMessages).toEqual([])

      server.close()

      socket.send('msg1')
      socket.send('msg2')

      expect(sentMessages).toEqual([])
      expect(receivedMessages).toEqual(['server1', 'server2'])

      server = new Server(URL)
      setupBufferTest(socket, server, receivedMessages, sentMessages)

      expect(socket.retries).toBe(1)
      await waitForSocketEvent(socket, 'open')

      expect(sentMessages).toEqual(['"msg1"', '"msg2"'])
      expect(receivedMessages).toEqual(['server1', 'server2', 'server1', 'server2', 'Server: "msg1"', 'Server: "msg2"'])

      socket.disconnect()
    })

    it('tracks the buffered amount', async () => {
      const socket = new Socket<string, any>(URL)
      await waitForConnection(socket)
      socket.pause()

      for (let i = 0; i < 10; i++) socket.send(`${i}`)

      expect(socket.bufferedAmount).toBe(10)

      for (let i = 0; i < 10; i++) socket.send(new Uint8Array([1]))

      expect(socket.bufferedAmount).toBe(20)

      for (let i = 0; i < 10; i++) socket.send(new Blob())

      expect(socket.bufferedAmount).toBe(20)

      for (let i = 0; i < 10; i++) socket.send(i)

      expect(socket.bufferedAmount).toBeGreaterThan(20)
    })
  })

  describe('Errors', () => {
    it('handles WebSocket creation errors', () => {
      const socket = new Socket('invalid-url')
      let errorData: Error | undefined

      socket.on('error', err => {
        errorData = err
      })

      socket.connect()

      expect(errorData).toBeInstanceOf(Error)
      expect(errorData!.message).toContain("The URL 'invalid-url' is invalid.")
    })

    it('handles invalid provided urls', () => {
      const socket = new Socket(() => 'invalid-url')
      let errorData: Error | undefined

      socket.on('error', err => {
        errorData = err
      })

      socket.connect()

      expect(errorData).toBeInstanceOf(Error)
      expect(errorData!.message).toContain("The URL 'invalid-url' is invalid.")
    })

    it('can abort the connection', async () => {
      const socket = new Socket(URL)

      let abortData: Error | undefined

      socket.on('abort', err => {
        abortData = err
      })

      await waitForConnection(socket)
      socket.abort('Manual Abort')

      expect(abortData).toBeInstanceOf(Error)
      expect(abortData!.message).toBe('Manual Abort')
    })

    it('handles errors on faulty onData callback', async () => {
      const localSocket = new Socket(URL)
      let errorData: Error | undefined
      let serverSocket: Client | undefined

      localSocket.on('error', error => {
        errorData = error
      })

      localSocket.onData(() => {
        throw new Error('OnData Error Test')
      })

      server.on('connection', socket => {
        serverSocket = socket
      })

      await waitForConnection(localSocket)
      serverSocket?.send('test')
      await vi.advanceTimersByTimeAsync(100)

      expect(errorData).toBeInstanceOf(Error)
      expect(errorData!.message).toContain('OnData Error Test')
    })

    it('errors on faulty data parser', async () => {
      const socket = new Socket<string, string>(URL)
      let errorData: Error | undefined

      socket.on('error', error => {
        errorData = error
      })

      await waitForConnection(socket)
      socket.send('test', data => {
        throw new Error(data)
      })

      expect(errorData).toBeInstanceOf(Error)
      expect(errorData!.message).toContain('test')
    })

    it('should not abort on pause', async () => {
      const socket = new Socket(URL)
      let counter = 0
      const count = () => {
        counter++
      }
      socket.on('abort', count)
      socket.on('error', count)

      socket.abort()
      await waitForConnection(socket)

      socket.pause()
      socket.abort()

      socket.disconnect()
      socket.abort()

      expect(counter).toBe(0)
    })

    it('sends an abort signal with payload to the server to close the connection', async () => {
      const localSocket = new Socket(URL)
      let sentMessage: string | undefined

      localSocket.on('data', data => {
        sentMessage = data.data
      })

      server.on('connection', socket => {
        socket.on('message', data => {
          socket.send(data)
        })
      })

      await waitForConnection(localSocket)
      localSocket.abort('Test', { id: 123 })
      await waitForSocketEvent(localSocket, 'data')

      expect(parseJson(sentMessage!)).toEqual({ type: 'abort', payload: { id: 123 } })
    })
  })

  describe('Keep Alive', () => {
    it('triggers keep-alive timeouts', async () => {
      const socket = new Socket(URL, { timeout: 100 })
      let closeCount = 0

      socket.on('close', () => {
        closeCount++
      })

      await waitForConnection(socket)
      await vi.advanceTimersByTimeAsync(150)
      expect(closeCount).toBe(1)
    })
  })
})
