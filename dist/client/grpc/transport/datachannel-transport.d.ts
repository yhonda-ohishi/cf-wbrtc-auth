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
import { RequestEnvelope, ResponseEnvelope } from '../codec/envelope';
export interface CallOptions {
    timeout?: number;
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
export declare class GrpcError extends Error {
    readonly code: number;
    readonly trailers: Record<string, string>;
    constructor(code: number, message: string, trailers: Record<string, string>);
}
/**
 * Streaming response interface
 */
export interface StreamingResponse<T> {
    headers: Record<string, string>;
    trailers: Record<string, string>;
    messages: AsyncIterable<T>;
}
/**
 * DataChannel Transport for gRPC-Web over WebRTC
 *
 * This transport wraps an RTCDataChannel and provides a high-level API
 * for making gRPC-Web style RPC calls. It handles request/response correlation
 * using request IDs, allowing multiple concurrent requests.
 */
export declare class DataChannelTransport {
    private dataChannel;
    private pendingRequests;
    private pendingStreamRequests;
    private requestIdCounter;
    private closed;
    constructor(dataChannel: RTCDataChannel);
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
    unary<Req, Resp>(path: string, request: Req, serialize: (msg: Req) => Uint8Array, deserialize: (data: Uint8Array) => Resp, options?: CallOptions): Promise<UnaryResponse<Resp>>;
    /**
     * Perform a server streaming RPC call
     *
     * @param path - Full method path, e.g., "/package.Service/Method"
     * @param request - Request message object
     * @param serialize - Function to serialize request message to bytes
     * @param deserialize - Function to deserialize response bytes to message
     * @param options - Call options (timeout, headers)
     * @returns StreamingResponse with async iterable messages
     */
    serverStreaming<Req, Resp>(path: string, request: Req, serialize: (msg: Req) => Uint8Array, deserialize: (data: Uint8Array) => Resp, options?: CallOptions): StreamingResponse<Resp>;
    /**
     * Low-level method to send raw request and get raw response
     *
     * @param envelope - Request envelope
     * @param options - Call options
     * @returns Promise resolving to response envelope
     * @throws {GrpcError} If the server returns an error status
     * @throws {Error} If the transport is closed or times out
     */
    call(envelope: RequestEnvelope, options?: CallOptions): Promise<ResponseEnvelope>;
    /**
     * Close the transport and clean up
     *
     * This will reject all pending requests and close the DataChannel.
     */
    close(): void;
    /**
     * Generate a unique request ID
     */
    private generateRequestId;
    /**
     * Handle incoming message from DataChannel
     */
    private handleMessage;
    /**
     * Handle incoming stream message
     */
    private handleStreamMessage;
    /**
     * Handle DataChannel close event
     */
    private handleClose;
    /**
     * Handle DataChannel error event
     */
    private handleError;
    /**
     * Get the underlying DataChannel
     *
     * Useful for checking connection state or adding custom event listeners.
     */
    get channel(): RTCDataChannel;
    /**
     * Check if the transport is closed
     */
    get isClosed(): boolean;
    /**
     * Get the number of pending requests
     */
    get pendingCount(): number;
}
//# sourceMappingURL=datachannel-transport.d.ts.map