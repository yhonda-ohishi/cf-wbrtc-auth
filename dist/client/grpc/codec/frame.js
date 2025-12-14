/**
 * gRPC-Web Frame Codec
 *
 * Frame format:
 * - 1 byte: flags (0 = data, 1 = trailer)
 * - 4 bytes: big-endian message length
 * - N bytes: message payload
 */
// Frame flags
export const FRAME_DATA = 0x00;
export const FRAME_TRAILER = 0x01;
// Frame header size (1 byte flags + 4 bytes length)
const FRAME_HEADER_SIZE = 5;
/**
 * Encode a single frame into gRPC-Web format
 */
export function encodeFrame(frame) {
    const messageLength = frame.data.length;
    const buffer = new Uint8Array(FRAME_HEADER_SIZE + messageLength);
    // Write flags (1 byte)
    buffer[0] = frame.flags;
    // Write length in big-endian (4 bytes)
    const view = new DataView(buffer.buffer);
    view.setUint32(1, messageLength, false); // false = big-endian
    // Write message data
    buffer.set(frame.data, FRAME_HEADER_SIZE);
    return buffer;
}
/**
 * Decode frames from buffer (may contain multiple frames or partial frames)
 * Returns decoded frames and any remaining bytes that don't form a complete frame
 */
export function decodeFrames(buffer) {
    const frames = [];
    let offset = 0;
    while (offset < buffer.length) {
        // Check if we have enough bytes for frame header
        if (offset + FRAME_HEADER_SIZE > buffer.length) {
            // Incomplete header, return remaining bytes
            return {
                frames,
                remaining: buffer.slice(offset),
            };
        }
        // Read flags
        const flags = buffer[offset];
        // Read message length (big-endian)
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4);
        const messageLength = view.getUint32(0, false); // false = big-endian
        // Check if we have enough bytes for the complete message
        const frameEnd = offset + FRAME_HEADER_SIZE + messageLength;
        if (frameEnd > buffer.length) {
            // Incomplete frame, return remaining bytes
            return {
                frames,
                remaining: buffer.slice(offset),
            };
        }
        // Extract frame data
        const data = buffer.slice(offset + FRAME_HEADER_SIZE, frameEnd);
        frames.push({ flags, data });
        offset = frameEnd;
    }
    // All bytes consumed
    return {
        frames,
        remaining: new Uint8Array(0),
    };
}
/**
 * Helper to create a data frame
 */
export function createDataFrame(data) {
    return {
        flags: FRAME_DATA,
        data,
    };
}
/**
 * Helper to create a trailer frame from headers
 * Trailers are encoded as HTTP/1.1 headers format:
 * "key1: value1\r\nkey2: value2\r\n"
 */
export function createTrailerFrame(trailers) {
    const lines = [];
    for (const [key, value] of Object.entries(trailers)) {
        lines.push(`${key}: ${value}`);
    }
    const trailerText = lines.join('\r\n') + '\r\n';
    const encoder = new TextEncoder();
    const data = encoder.encode(trailerText);
    return {
        flags: FRAME_TRAILER,
        data,
    };
}
/**
 * Parse trailer frame data to headers
 * Expects HTTP/1.1 header format: "key1: value1\r\nkey2: value2\r\n"
 */
export function parseTrailers(data) {
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(data);
    const trailers = {};
    // Split by CRLF
    const lines = text.split('\r\n');
    for (const line of lines) {
        // Skip empty lines
        if (!line.trim()) {
            continue;
        }
        // Parse "key: value" format
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            continue; // Invalid header line, skip
        }
        const key = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim();
        trailers[key] = value;
    }
    return trailers;
}
