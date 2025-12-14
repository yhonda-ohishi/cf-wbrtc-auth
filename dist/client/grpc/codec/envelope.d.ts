/**
 * gRPC-Web Envelope Codec
 *
 * Handles the higher-level gRPC-Web message envelope format which wraps
 * the RPC call structure. This includes routing info (path, headers) and
 * uses the Frame codec for the actual gRPC-Web framing.
 *
 * Request format over DataChannel:
 * - 4 bytes: path length (big-endian)
 * - N bytes: path string (UTF-8)
 * - 4 bytes: headers length (big-endian)
 * - M bytes: headers as JSON string
 * - Rest: gRPC-Web frames (data frames containing the message)
 *
 * Response format:
 * - 4 bytes: headers length (big-endian)
 * - N bytes: headers as JSON string
 * - Rest: gRPC-Web frames (data frames + trailer frame)
 */
export interface RequestEnvelope {
    path: string;
    headers: Record<string, string>;
    message: Uint8Array;
}
export interface ResponseEnvelope {
    headers: Record<string, string>;
    messages: Uint8Array[];
    trailers: Record<string, string>;
}
export declare const StatusCode: {
    readonly OK: 0;
    readonly CANCELLED: 1;
    readonly UNKNOWN: 2;
    readonly INVALID_ARGUMENT: 3;
    readonly DEADLINE_EXCEEDED: 4;
    readonly NOT_FOUND: 5;
    readonly ALREADY_EXISTS: 6;
    readonly PERMISSION_DENIED: 7;
    readonly RESOURCE_EXHAUSTED: 8;
    readonly FAILED_PRECONDITION: 9;
    readonly ABORTED: 10;
    readonly OUT_OF_RANGE: 11;
    readonly UNIMPLEMENTED: 12;
    readonly INTERNAL: 13;
    readonly UNAVAILABLE: 14;
    readonly DATA_LOSS: 15;
    readonly UNAUTHENTICATED: 16;
};
/**
 * Encode a request envelope for sending over DataChannel
 *
 * Format:
 * [path_len(4)][path(N)][headers_len(4)][headers_json(M)][grpc_frames]
 */
export declare function encodeRequest(envelope: RequestEnvelope): Uint8Array;
/**
 * Decode a response envelope received from DataChannel
 *
 * Format:
 * [headers_len(4)][headers_json(N)][grpc_frames]
 *
 * The gRPC frames contain data frames (protobuf messages) followed by
 * a trailer frame (grpc-status, grpc-message, etc.)
 */
export declare function decodeResponse(data: Uint8Array): ResponseEnvelope;
/**
 * Create an error response envelope
 *
 * This is useful for creating error responses on the server side
 * or simulating errors on the client side for testing.
 */
export declare function createErrorResponse(code: number, message: string): ResponseEnvelope;
/**
 * Encode a response envelope for sending over DataChannel
 *
 * This is typically used on the server (Go app) side.
 *
 * Format:
 * [headers_len(4)][headers_json(N)][data_frames...][trailer_frame]
 */
export declare function encodeResponse(envelope: ResponseEnvelope): Uint8Array;
/**
 * Check if a response is an error
 */
export declare function isErrorResponse(envelope: ResponseEnvelope): boolean;
/**
 * Get error details from a response envelope
 */
export declare function getError(envelope: ResponseEnvelope): {
    code: number;
    message: string;
} | null;
/**
 * Get status code name from code number
 */
export declare function getStatusName(code: number): string;
export declare const StreamFlag: {
    readonly DATA: 0;
    readonly END: 1;
};
export interface StreamMessage {
    requestId: string;
    flag: number;
    data: Uint8Array;
}
/**
 * Decode a stream message received from DataChannel
 * Format: [requestId_len(4)][requestId(N)][flag(1)][data...]
 */
export declare function decodeStreamMessage(data: Uint8Array): StreamMessage;
/**
 * Check if data is a stream message
 *
 * Stream messages have format: [requestId_len(4)][requestId(N)][flag(1)][data]
 * where requestId starts with "stream-" prefix
 *
 * Unary responses have format: [headers_len(4)][headers_json(N)][grpc_frames]
 * where headers_json starts with "{"
 *
 * We distinguish them by checking if the string after the length starts with "stream-"
 * (stream message) or "{" (unary response)
 */
export declare function isStreamMessage(data: Uint8Array): boolean;
//# sourceMappingURL=envelope.d.ts.map