/**
 * gRPC-Web over DataChannel Transport Library
 *
 * This library provides a transport layer for gRPC-Web style communication
 * over WebRTC DataChannel. Proto definitions are the user's responsibility;
 * this library only provides the generic transport.
 *
 * @example
 * ```typescript
 * import { DataChannelTransport, GrpcError, StatusCode } from './grpc';
 *
 * // Create transport from an existing DataChannel
 * const transport = new DataChannelTransport(dataChannel);
 *
 * // Make a unary call
 * const response = await transport.unary(
 *   '/mypackage.MyService/MyMethod',
 *   myRequest,
 *   serializeRequest,
 *   deserializeResponse
 * );
 * ```
 */

// Codec exports - for advanced users who need low-level access
export {
  // Frame codec
  FRAME_DATA,
  FRAME_TRAILER,
  type Frame,
  encodeFrame,
  decodeFrames,
  createDataFrame,
  createTrailerFrame,
  parseTrailers,
} from './codec/frame';

export {
  // Envelope codec
  type RequestEnvelope,
  type ResponseEnvelope,
  StatusCode,
  encodeRequest,
  decodeResponse,
  encodeResponse,
  createErrorResponse,
  isErrorResponse,
  getError,
  getStatusName,
  // Stream message codec
  StreamFlag,
  type StreamMessage,
  decodeStreamMessage,
  isStreamMessage,
} from './codec/envelope';

// Transport exports - main API for users
export {
  DataChannelTransport,
  GrpcError,
  type CallOptions,
  type UnaryResponse,
  type StreamingResponse,
} from './transport/datachannel-transport';

// Reflection exports - for service discovery
export {
  ReflectionClient,
  REFLECTION_METHOD_PATH,
  type ServiceInfo,
  type ListServicesResponse,
} from './reflection/reflection';
