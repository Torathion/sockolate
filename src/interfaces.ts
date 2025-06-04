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
  /*  Coonfiguration for a reconnect. */
  retry: RetryConfig
  /**
   *  The amount of time in where to timeout the WebSocket for inactivity in ms.
   *
   *  @defaultValue `30000`
   */
  timeout: number
}
