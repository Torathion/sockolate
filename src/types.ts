import type { TypedArray } from 'typestar'

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
