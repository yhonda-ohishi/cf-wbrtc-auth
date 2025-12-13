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

import {
  Frame,
  encodeFrame,
  decodeFrames,
  createDataFrame,
  createTrailerFrame,
  parseTrailers,
  FRAME_DATA,
  FRAME_TRAILER,
} from './frame';

// Request envelope sent from client to server
export interface RequestEnvelope {
  // Full method path, e.g., "/package.Service/Method"
  path: string;
  // Request headers (metadata)
  headers: Record<string, string>;
  // Serialized protobuf message
  message: Uint8Array;
}

// Response envelope received from server
export interface ResponseEnvelope {
  // Response headers from server
  headers: Record<string, string>;
  // Serialized protobuf messages (can be multiple for streaming)
  messages: Uint8Array[];
  // Response trailers (contains grpc-status, grpc-message)
  trailers: Record<string, string>;
}

// Standard gRPC status codes
export const StatusCode = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

/**
 * Encode a request envelope for sending over DataChannel
 *
 * Format:
 * [path_len(4)][path(N)][headers_len(4)][headers_json(M)][grpc_frames]
 */
export function encodeRequest(envelope: RequestEnvelope): Uint8Array {
  const encoder = new TextEncoder();

  // Encode path
  const pathBytes = encoder.encode(envelope.path);
  const pathLength = pathBytes.length;

  // Encode headers as JSON
  const headersJson = JSON.stringify(envelope.headers);
  const headersBytes = encoder.encode(headersJson);
  const headersLength = headersBytes.length;

  // Create gRPC-Web data frame for the message
  const dataFrame = createDataFrame(envelope.message);
  const frameBytes = encodeFrame(dataFrame);

  // Calculate total length
  const totalLength = 4 + pathLength + 4 + headersLength + frameBytes.length;

  // Allocate buffer
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  let offset = 0;

  // Write path length (big-endian)
  view.setUint32(offset, pathLength, false);
  offset += 4;

  // Write path
  buffer.set(pathBytes, offset);
  offset += pathLength;

  // Write headers length (big-endian)
  view.setUint32(offset, headersLength, false);
  offset += 4;

  // Write headers
  buffer.set(headersBytes, offset);
  offset += headersLength;

  // Write gRPC-Web frames
  buffer.set(frameBytes, offset);

  return buffer;
}

/**
 * Decode a response envelope received from DataChannel
 *
 * Format:
 * [headers_len(4)][headers_json(N)][grpc_frames]
 *
 * The gRPC frames contain data frames (protobuf messages) followed by
 * a trailer frame (grpc-status, grpc-message, etc.)
 */
export function decodeResponse(data: Uint8Array): ResponseEnvelope {
  const decoder = new TextDecoder('utf-8');
  const view = new DataView(data.buffer, data.byteOffset);

  let offset = 0;

  // Read headers length
  if (offset + 4 > data.length) {
    throw new Error('Incomplete response: missing headers length');
  }
  const headersLength = view.getUint32(offset, false);
  offset += 4;

  // Read headers
  if (offset + headersLength > data.length) {
    throw new Error('Incomplete response: missing headers');
  }
  const headersBytes = data.slice(offset, offset + headersLength);
  const headersJson = decoder.decode(headersBytes);
  const headers = JSON.parse(headersJson) as Record<string, string>;
  offset += headersLength;

  // Decode gRPC-Web frames
  const framesData = data.slice(offset);
  const { frames, remaining } = decodeFrames(framesData);

  if (remaining.length > 0) {
    throw new Error('Incomplete response: partial frame remaining');
  }

  // Separate data frames and trailer frame
  const messages: Uint8Array[] = [];
  let trailers: Record<string, string> = {};

  for (const frame of frames) {
    if (frame.flags === FRAME_DATA) {
      messages.push(frame.data);
    } else if (frame.flags === FRAME_TRAILER) {
      trailers = parseTrailers(frame.data);
    } else {
      throw new Error(`Unknown frame flags: ${frame.flags}`);
    }
  }

  return {
    headers,
    messages,
    trailers,
  };
}

/**
 * Create an error response envelope
 *
 * This is useful for creating error responses on the server side
 * or simulating errors on the client side for testing.
 */
export function createErrorResponse(code: number, message: string): ResponseEnvelope {
  const trailers: Record<string, string> = {
    'grpc-status': code.toString(),
    'grpc-message': message,
  };

  return {
    headers: {},
    messages: [],
    trailers,
  };
}

/**
 * Encode a response envelope for sending over DataChannel
 *
 * This is typically used on the server (Go app) side.
 *
 * Format:
 * [headers_len(4)][headers_json(N)][data_frames...][trailer_frame]
 */
export function encodeResponse(envelope: ResponseEnvelope): Uint8Array {
  const encoder = new TextEncoder();

  // Encode headers as JSON
  const headersJson = JSON.stringify(envelope.headers);
  const headersBytes = encoder.encode(headersJson);
  const headersLength = headersBytes.length;

  // Encode data frames
  const dataFrameBytes: Uint8Array[] = [];
  let dataFramesLength = 0;

  for (const message of envelope.messages) {
    const dataFrame = createDataFrame(message);
    const frameBytes = encodeFrame(dataFrame);
    dataFrameBytes.push(frameBytes);
    dataFramesLength += frameBytes.length;
  }

  // Encode trailer frame
  const trailerFrame = createTrailerFrame(envelope.trailers);
  const trailerBytes = encodeFrame(trailerFrame);

  // Calculate total length
  const totalLength = 4 + headersLength + dataFramesLength + trailerBytes.length;

  // Allocate buffer
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  let offset = 0;

  // Write headers length (big-endian)
  view.setUint32(offset, headersLength, false);
  offset += 4;

  // Write headers
  buffer.set(headersBytes, offset);
  offset += headersLength;

  // Write data frames
  for (const frameBytes of dataFrameBytes) {
    buffer.set(frameBytes, offset);
    offset += frameBytes.length;
  }

  // Write trailer frame
  buffer.set(trailerBytes, offset);

  return buffer;
}

/**
 * Check if a response is an error
 */
export function isErrorResponse(envelope: ResponseEnvelope): boolean {
  const status = envelope.trailers['grpc-status'];
  if (!status) {
    return false;
  }
  return parseInt(status, 10) !== StatusCode.OK;
}

/**
 * Get error details from a response envelope
 */
export function getError(envelope: ResponseEnvelope): { code: number; message: string } | null {
  if (!isErrorResponse(envelope)) {
    return null;
  }

  const code = parseInt(envelope.trailers['grpc-status'] || '2', 10);
  const message = envelope.trailers['grpc-message'] || 'Unknown error';

  return { code, message };
}

/**
 * Get status code name from code number
 */
export function getStatusName(code: number): string {
  const entry = Object.entries(StatusCode).find(([_, value]) => value === code);
  return entry ? entry[0] : 'UNKNOWN';
}
