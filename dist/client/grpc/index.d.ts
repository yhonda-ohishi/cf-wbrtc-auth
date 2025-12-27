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
export { FRAME_DATA, FRAME_TRAILER, type Frame, encodeFrame, decodeFrames, createDataFrame, createTrailerFrame, parseTrailers, } from './codec/frame';
export { type RequestEnvelope, type ResponseEnvelope, StatusCode, encodeRequest, decodeResponse, encodeResponse, createErrorResponse, isErrorResponse, getError, getStatusName, StreamFlag, type StreamMessage, decodeStreamMessage, isStreamMessage, } from './codec/envelope';
export { DataChannelTransport, GrpcError, type CallOptions, type UnaryResponse, type StreamingResponse, } from './transport/datachannel-transport';
export { ReflectionClient, REFLECTION_METHOD_PATH, FILE_CONTAINING_SYMBOL_PATH, type ServiceInfo, type ListServicesResponse, type FileContainingSymbolRequest, type FileContainingSymbolResponse, type FieldInfo, type MessageInfo, type EnumInfo, type ServiceDescriptor, type MethodDescriptor, type FileDescriptor, parseFileDescriptor, getFieldInfo, } from './reflection/reflection';
//# sourceMappingURL=index.d.ts.map