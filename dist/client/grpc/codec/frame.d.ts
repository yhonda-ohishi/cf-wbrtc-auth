/**
 * gRPC-Web Frame Codec
 *
 * Frame format:
 * - 1 byte: flags (0 = data, 1 = trailer)
 * - 4 bytes: big-endian message length
 * - N bytes: message payload
 */
export declare const FRAME_DATA = 0;
export declare const FRAME_TRAILER = 1;
export interface Frame {
    flags: number;
    data: Uint8Array;
}
/**
 * Encode a single frame into gRPC-Web format
 */
export declare function encodeFrame(frame: Frame): Uint8Array;
/**
 * Decode frames from buffer (may contain multiple frames or partial frames)
 * Returns decoded frames and any remaining bytes that don't form a complete frame
 */
export declare function decodeFrames(buffer: Uint8Array): {
    frames: Frame[];
    remaining: Uint8Array;
};
/**
 * Helper to create a data frame
 */
export declare function createDataFrame(data: Uint8Array): Frame;
/**
 * Helper to create a trailer frame from headers
 * Trailers are encoded as HTTP/1.1 headers format:
 * "key1: value1\r\nkey2: value2\r\n"
 */
export declare function createTrailerFrame(trailers: Record<string, string>): Frame;
/**
 * Parse trailer frame data to headers
 * Expects HTTP/1.1 header format: "key1: value1\r\nkey2: value2\r\n"
 */
export declare function parseTrailers(data: Uint8Array): Record<string, string>;
//# sourceMappingURL=frame.d.ts.map