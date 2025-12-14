/**
 * DataChannel Transport for gRPC-Web
 *
 * Enables gRPC-Web style RPC calls over WebRTC DataChannel.
 * Compatible with Connect-Web's Transport interface pattern.
 *
 * Features:
 * - Multiple concurrent requests using request IDs
 * - Timeout handling
 * - Error responses (throws GrpcError)
 * - Channel closing (rejects all pending requests)
 */

import {
  RequestEnvelope,
  ResponseEnvelope,
  encodeRequest,
  decodeResponse,
  isErrorResponse,
  getError,
  StatusCode,
} from '../codec/envelope';

export interface CallOptions {
  timeout?: number; // ms, default 30000
  headers?: Record<string, string>;
}

export interface UnaryResponse<T> {
  message: T;
  headers: Record<string, string>;
  trailers: Record<string, string>;
}

/**
 * Error thrown on gRPC errors
 */
export class GrpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly trailers: Record<string, string>
  ) {
    super(message);
    this.name = 'GrpcError';
  }
}

/**
 * Internal structure for tracking pending requests
 */
interface PendingRequest {
  resolve: (response: ResponseEnvelope) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * DataChannel Transport for gRPC-Web over WebRTC
 *
 * This transport wraps an RTCDataChannel and provides a high-level API
 * for making gRPC-Web style RPC calls. It handles request/response correlation
 * using request IDs, allowing multiple concurrent requests.
 */
export class DataChannelTransport {
  private dataChannel: RTCDataChannel;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private closed = false;

  constructor(dataChannel: RTCDataChannel) {
    this.dataChannel = dataChannel;

    // Set binary type to arraybuffer for receiving binary data
    this.dataChannel.binaryType = 'arraybuffer';

    // Set up message handler
    this.dataChannel.addEventListener('message', this.handleMessage.bind(this));

    // Set up close handler
    this.dataChannel.addEventListener('close', this.handleClose.bind(this));
    this.dataChannel.addEventListener('error', this.handleError.bind(this));
  }

  /**
   * Perform a unary RPC call
   *
   * @param path - Full method path, e.g., "/package.Service/Method"
   * @param request - Request message object
   * @param serialize - Function to serialize request message to bytes
   * @param deserialize - Function to deserialize response bytes to message
   * @param options - Call options (timeout, headers)
   * @returns Promise resolving to the response
   */
  async unary<Req, Resp>(
    path: string,
    request: Req,
    serialize: (msg: Req) => Uint8Array,
    deserialize: (data: Uint8Array) => Resp,
    options?: CallOptions
  ): Promise<UnaryResponse<Resp>> {
    // Serialize request message
    const messageBytes = serialize(request);

    // Generate request ID and prepare headers
    const requestId = this.generateRequestId();
    const headers = {
      'x-request-id': requestId,
      ...(options?.headers || {}),
    };

    // Create request envelope
    const envelope: RequestEnvelope = {
      path,
      headers,
      message: messageBytes,
    };

    // Send request and wait for response
    const responseEnvelope = await this.call(envelope, options);

    // Validate response has exactly one message for unary call
    if (responseEnvelope.messages.length === 0) {
      throw new Error('No response message received for unary call');
    }
    if (responseEnvelope.messages.length > 1) {
      throw new Error(
        `Expected single response message, got ${responseEnvelope.messages.length}`
      );
    }

    // Deserialize response message
    const message = deserialize(responseEnvelope.messages[0]);

    return {
      message,
      headers: responseEnvelope.headers,
      trailers: responseEnvelope.trailers,
    };
  }

  /**
   * Low-level method to send raw request and get raw response
   *
   * @param envelope - Request envelope
   * @param options - Call options
   * @returns Promise resolving to response envelope
   * @throws {GrpcError} If the server returns an error status
   * @throws {Error} If the transport is closed or times out
   */
  async call(envelope: RequestEnvelope, options?: CallOptions): Promise<ResponseEnvelope> {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

    // Extract request ID from headers
    const requestId = envelope.headers['x-request-id'];
    if (!requestId) {
      throw new Error('Request envelope must include x-request-id header');
    }

    // Set up timeout
    const timeoutMs = options?.timeout || 30000;

    // Create promise for response
    const responsePromise = new Promise<ResponseEnvelope>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });
    });

    // Encode and send request
    const encodedRequest = encodeRequest(envelope);

    try {
      // Cast to ArrayBuffer for RTCDataChannel.send compatibility
      this.dataChannel.send(encodedRequest as unknown as ArrayBuffer);
    } catch (error) {
      // Clean up pending request on send failure
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
      }
      throw error;
    }

    // Wait for response
    const responseEnvelope = await responsePromise;

    // Check for gRPC errors
    if (isErrorResponse(responseEnvelope)) {
      const error = getError(responseEnvelope);
      if (error) {
        throw new GrpcError(error.code, error.message, responseEnvelope.trailers);
      } else {
        throw new GrpcError(
          StatusCode.UNKNOWN,
          'Unknown error',
          responseEnvelope.trailers
        );
      }
    }

    return responseEnvelope;
  }

  /**
   * Close the transport and clean up
   *
   * This will reject all pending requests and close the DataChannel.
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // Reject all pending requests
    const error = new Error('Transport closed');
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    // Close DataChannel
    if (this.dataChannel.readyState === 'open') {
      this.dataChannel.close();
    }

    // Remove event listeners
    this.dataChannel.removeEventListener('message', this.handleMessage.bind(this));
    this.dataChannel.removeEventListener('close', this.handleClose.bind(this));
    this.dataChannel.removeEventListener('error', this.handleError.bind(this));
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    this.requestIdCounter++;
    return `req-${Date.now()}-${this.requestIdCounter}`;
  }

  /**
   * Handle incoming message from DataChannel
   */
  private handleMessage(event: MessageEvent): void {
    if (this.closed) {
      return;
    }

    // Convert ArrayBuffer to Uint8Array
    const data = new Uint8Array(event.data as ArrayBuffer);

    try {
      // Decode response envelope
      const responseEnvelope = decodeResponse(data);

      // Extract request ID from response headers
      const requestId = responseEnvelope.headers['x-request-id'];
      if (!requestId) {
        console.error('Received response without x-request-id header');
        return;
      }

      // Find pending request
      const pending = this.pendingRequests.get(requestId);
      if (!pending) {
        console.warn(`Received response for unknown request ID: ${requestId}`);
        return;
      }

      // Clean up timeout
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      // Resolve promise
      pending.resolve(responseEnvelope);
    } catch (error) {
      console.error('Failed to decode response:', error);
      // We don't know which request this belongs to, so we can't reject it
    }
  }

  /**
   * Handle DataChannel close event
   */
  private handleClose(): void {
    if (this.closed) {
      return;
    }

    // Reject all pending requests
    const error = new Error('DataChannel closed');
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    this.closed = true;
  }

  /**
   * Handle DataChannel error event
   */
  private handleError(event: Event): void {
    console.error('DataChannel error:', event);
    // The close event will be fired next, which will clean up
  }

  /**
   * Get the underlying DataChannel
   *
   * Useful for checking connection state or adding custom event listeners.
   */
  get channel(): RTCDataChannel {
    return this.dataChannel;
  }

  /**
   * Check if the transport is closed
   */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get the number of pending requests
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}
