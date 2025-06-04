# sockolate

<p align="center">
<h1 align="center">Sweet, Tasty WebSockets with enriched feature flavors</h1>
<p align="center">
  <a href="https://www.npmjs.com/package/sockolate"><img src="https://img.shields.io/npm/v/sockolate?style=for-the-badge&logo=npm"/></a>
  <a href="https://npmtrends.com/sockolate"><img src="https://img.shields.io/npm/dm/sockolate?style=for-the-badge"/></a>
  <a href="https://bundlephobia.com/package/sockolate"><img src="https://img.shields.io/bundlephobia/minzip/sockolate?style=for-the-badge"/></a>
  <a href="https://github.com/Torathion/sockolate/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Torathion/sockolate?style=for-the-badge"/></a>
  <a href="https://codecov.io/gh/torathion/sockolate"><img src="https://codecov.io/gh/torathion/sockolate/branch/main/graph/badge.svg?style=for-the-badge" /></a>
  <a href="https://github.com/torathion/sockolate/actions"><img src="https://img.shields.io/github/actions/workflow/status/torathion/sockolate/build.yml?style=for-the-badge&logo=esbuild"/></a>
<a href="https://github.com/prettier/prettier#readme"><img alt="code style" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=for-the-badge&logo=prettier"></a>
</p>
</p>

`sockolate` is a versatile and and feature-rich [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) handler to handle even the most advance WebSocket use-cases easily and quickly.

```powershell
    pnpm i sockolate
```

## Features

While WebSockets are already feature-rich for secure and fast bidirectional data connections, many use cases require even more fine-grained WebSockets to easily handle errors or connection problems.
Which is why `sockolate` enhances WebSockets with:

- Reconnections
- Inward and outward data buffering
- Connection Pausing
- Keep-Alive-Timers
- Pinging
- Heartbeat Connections

## Usage

To use WebSockets, `sockolate` provides a `Socket` class that just works like a WebSocket:

```typescript
import Socket from 'sockolate'

const socket = new Socket('ws://localhost:3000')

socket.connect()

// Or shorter:
new Socket('ws://localhost:3000', { immediate: true })
```

### Events

`sockolate` provides vast and complex lifecycle events for a lot of features and procedures you can do with the `Socket`. Those include:

- `preConnect` before the internal WebSocket is created.
- `open` when the WebSocket has successfully connected with the server.
- `data` on receiving messages. The handler holds the received message.
- `send` on sending messages.
- `close` when the WebSocket is closing. Holds `CloseEvent` metadata.
- `error` on receiving an Error from either the server or the `Socket`. It holds an error object.
- `abort` on forced and abrupt closure of the connection. It holds the same error object.
- `reconnect` on initiating a reconnection
- `ping` on sending a ping message.
- `pong` on receiving a ping response from the server.

Furthermore, `Socket` distinguishes between central callbacks and events. Central callbacks hold the actual logic and state management that surround the actual event listeners of the WebSocket. The events are only secondary and accompany the actual callbacks. They are intended for use in external handling.

```typescript
import Socket from 'sockolate'

const socket = new Socket('ws://localhost:3000')

// Central callbacks
socket.onOpen(() => {})
socket.onClose(() => {})
socket.onError(() => {})
socket.onData(() => {})

// Events
socket.on('open', () => {})
socket.on('reconnect', () => {})
socket.on('ping', () => {})
```

### Reconnections

When a connection receives an error, is aborted, closes or a reconnection was triggered manually, the `Socket` tries to disconnect and re-establish the connection:

```typescript
import Socket from 'sockolate'

const socket = new Socket('ws://localhost:3000', { retry: { amount: 4, minUpTime: 500, startDelay: 1000, maxDelay: 30000, onAbort: true }})

socket.connect()
socket.on('reconnect', () => {
  console.log("Reconnecting!")
})

// If onAbort is true, the socket can be aborted and will try to reconnect
socket.abort('Reconnect')

// You can also manually reconnect
socket.reconnect()
```

### Pausing and Buffers

`Socket` improves upon the built-in WebSocket message buffering by allowing bidirectional message buffering. You can pause the buffer and it will hold all processes and message parsing and sending. Buffering is on by default and will release all buffers immediately on resume:

```typescript
import Socket from 'sockolate'

const socket = new Socket('ws://localhost:3000', { buffer: { max: 32, min: 0 }})
socket.connect()
// Sending data
socket.send('Test')
socket.send(5, (x: number) => x.toString()) // Sending data with custom parser!

// Pausing the socket
socket.pause()

// Data will be buffered
socket.send('Test2')
socket.send(5, (x: number) => x.toString())

console.log(socket.bufferedAmount)
// Releases all buffers.
socket.resume()
```

You can also deactivate buffering entirely (except for the built-in buffering) by setting `{ buffer: false }`.

### Pinging and Heartbeat

To keep WebSockets alive, `Socket` has not only an internal keepalive timer that disconnects the connection based on the maximum `timeout` passed into the options, it also allows to ping the server and establish a heartbeat connection. A heartbeat connection will run indefinitely, but won't start if there is already a ping.:

```typescript
import Socket from 'sockolate'

// Defines a heartbeat interval of 3s, a ping timeout of 5s and strictly errors on no response.
const socket = new Socket('ws://localhost:3000', { ping: { heartbeat: 3000, ping: 5000, strict: true }, timeout: 30000 })

socket.connect()
socket.ping()

// Initiates the heartbeat.
socket.startBeat()
console.log(socket.beating)
socket.stopBeat()
```

---

© Torathion 2025
