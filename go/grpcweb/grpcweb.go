// Package grpcweb provides gRPC-Web transport over WebRTC DataChannel.
//
// This library allows gRPC-Web style communication over WebRTC DataChannel,
// enabling browser-to-app RPC calls through P2P connections. Proto definitions
// are the user's responsibility; this library only provides the generic transport.
//
// # Architecture
//
//	Browser Client (TypeScript)         Go Server
//	          |                              |
//	          |  RequestEnvelope            |
//	          |----------------------------->|
//	          |                              |
//	          |                       Decode Request
//	          |                       Route to Handler
//	          |                       Execute Handler
//	          |                       Encode Response
//	          |                              |
//	          |  ResponseEnvelope            |
//	          |<-----------------------------|
//	          |                              |
//
// # Quick Start
//
// Server side (Go):
//
//	import (
//	    "github.com/anthropics/cf-wbrtc-auth/go/grpcweb"
//	)
//
//	// Create transport from WebRTC data channel
//	transport := grpcweb.NewTransport(dataChannel, nil)
//
//	// Register handler using MakeHandler for type safety
//	handler := grpcweb.MakeHandler(
//	    deserializeRequest,  // func([]byte) (Request, error)
//	    serializeResponse,   // func(Response) ([]byte, error)
//	    myHandlerFunc,       // func(ctx, Request) (Response, error)
//	)
//	transport.RegisterHandler("/mypackage.MyService/MyMethod", handler)
//
//	// Start handling requests
//	transport.Start()
//
// # Subpackages
//
// The library is organized into two subpackages:
//
//   - codec: Low-level frame and envelope encoding/decoding
//   - transport: High-level DataChannel transport with request routing
//
// For most use cases, use the re-exported types from this package.
package grpcweb

import (
	"context"
	"time"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/reflection"
	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/transport"
	"github.com/pion/webrtc/v4"
)

// Re-export codec types
type (
	// Frame represents a gRPC-Web frame
	Frame = codec.Frame
	// RequestEnvelope is sent from client to server
	RequestEnvelope = codec.RequestEnvelope
	// ResponseEnvelope is received from server
	ResponseEnvelope = codec.ResponseEnvelope
	// GRPCError represents a gRPC error
	GRPCError = codec.GRPCError
)

// Re-export codec constants
const (
	FrameData    = codec.FrameData
	FrameTrailer = codec.FrameTrailer

	StatusOK                 = codec.StatusOK
	StatusCancelled          = codec.StatusCancelled
	StatusUnknown            = codec.StatusUnknown
	StatusInvalidArgument    = codec.StatusInvalidArgument
	StatusDeadlineExceeded   = codec.StatusDeadlineExceeded
	StatusNotFound           = codec.StatusNotFound
	StatusAlreadyExists      = codec.StatusAlreadyExists
	StatusPermissionDenied   = codec.StatusPermissionDenied
	StatusResourceExhausted  = codec.StatusResourceExhausted
	StatusFailedPrecondition = codec.StatusFailedPrecondition
	StatusAborted            = codec.StatusAborted
	StatusOutOfRange         = codec.StatusOutOfRange
	StatusUnimplemented      = codec.StatusUnimplemented
	StatusInternal           = codec.StatusInternal
	StatusUnavailable        = codec.StatusUnavailable
	StatusDataLoss           = codec.StatusDataLoss
	StatusUnauthenticated    = codec.StatusUnauthenticated
)

// Re-export codec functions
var (
	// Frame encoding/decoding
	EncodeFrame       = codec.EncodeFrame
	DecodeFrames      = codec.DecodeFrames
	CreateDataFrame   = codec.CreateDataFrame
	CreateTrailerFrame = codec.CreateTrailerFrame
	ParseTrailers     = codec.ParseTrailers

	// Envelope encoding/decoding
	EncodeRequest      = codec.EncodeRequest
	DecodeRequest      = codec.DecodeRequest
	EncodeResponse     = codec.EncodeResponse
	DecodeResponse     = codec.DecodeResponse
	CreateErrorResponse = codec.CreateErrorResponse
	IsErrorResponse    = codec.IsErrorResponse
	GetError           = codec.GetError
	GetStatusName      = codec.GetStatusName
)

// Transport is the server-side gRPC-Web transport over DataChannel
type Transport = transport.DataChannelTransport

// Handler handles a gRPC method call
type Handler = transport.Handler

// StreamingHandler handles a server-streaming gRPC method call
type StreamingHandler = transport.StreamingHandler

// ServerStream provides methods to send streaming responses
type ServerStream = transport.ServerStream

// TypedServerStream provides a typed wrapper for ServerStream
type TypedServerStream[Resp any] = transport.TypedServerStream[Resp]

// HandlerOptions provides options for handling requests
type HandlerOptions = transport.HandlerOptions

// NewTransport creates a new Transport from a WebRTC DataChannel.
//
// The opts parameter is optional; if nil, defaults are used.
func NewTransport(dc *webrtc.DataChannel, opts *HandlerOptions) *Transport {
	return transport.NewDataChannelTransport(dc, opts)
}

// NewTransportWithTimeout creates a new Transport with a custom timeout.
func NewTransportWithTimeout(dc *webrtc.DataChannel, timeout time.Duration) *Transport {
	return transport.NewDataChannelTransport(dc, &HandlerOptions{
		Timeout: timeout,
	})
}

// MakeHandler creates a Handler from typed serialization functions.
//
// This provides type safety for handlers by separating serialization
// from business logic.
//
// Example:
//
//	handler := grpcweb.MakeHandler(
//	    func(data []byte) (MyRequest, error) {
//	        var req MyRequest
//	        err := proto.Unmarshal(data, &req)
//	        return req, err
//	    },
//	    func(resp MyResponse) ([]byte, error) {
//	        return proto.Marshal(&resp)
//	    },
//	    func(ctx context.Context, req MyRequest) (MyResponse, error) {
//	        // Handle request
//	        return MyResponse{Result: "ok"}, nil
//	    },
//	)
func MakeHandler[Req, Resp any](
	deserialize func([]byte) (Req, error),
	serialize func(Resp) ([]byte, error),
	handle func(ctx context.Context, req Req) (Resp, error),
) Handler {
	return transport.MakeHandler(deserialize, serialize, handle)
}

// MakeStreamingHandler creates a StreamingHandler from typed serialization functions.
func MakeStreamingHandler[Req, Resp any](
	deserialize func([]byte) (Req, error),
	serialize func(Resp) ([]byte, error),
	handle func(req Req, stream *TypedServerStream[Resp]) error,
) StreamingHandler {
	return transport.MakeStreamingHandler(deserialize, serialize, handle)
}

// NewErrorResponse creates an error ResponseEnvelope with the given status code
// and message. This is useful for returning errors from handlers.
func NewErrorResponse(code int, message string) ResponseEnvelope {
	return codec.CreateErrorResponse(code, message)
}

// NewSuccessResponse creates a successful ResponseEnvelope with the given
// message data. Multiple messages can be passed for streaming responses.
func NewSuccessResponse(messages ...[]byte) ResponseEnvelope {
	return ResponseEnvelope{
		Headers:  map[string]string{},
		Messages: messages,
		Trailers: map[string]string{
			"grpc-status": "0",
		},
	}
}

// Reflection types and functions
type (
	// Reflection provides server reflection functionality
	Reflection = reflection.Reflection
	// ServiceInfo contains information about a registered service
	ServiceInfo = reflection.ServiceInfo
	// ListServicesResponse is the response for ListServices
	ListServicesResponse = reflection.ListServicesResponse
	// FileContainingSymbolRequest is the request for FileContainingSymbol
	FileContainingSymbolRequest = reflection.FileContainingSymbolRequest
	// FileContainingSymbolResponse is the response for FileContainingSymbol
	FileContainingSymbolResponse = reflection.FileContainingSymbolResponse
)

// ReflectionMethodPath is the path for the ListServices method
const ReflectionMethodPath = reflection.MethodPath

// FileContainingSymbolPath is the path for the FileContainingSymbol method
const FileContainingSymbolPath = reflection.FileContainingSymbolPath

// NewReflection creates a new Reflection instance.
// The transport must implement the HandlerRegistry interface.
//
// Example:
//
//	transport := grpcweb.NewTransport(dataChannel, nil)
//	refl := grpcweb.NewReflection(transport)
//	transport.RegisterHandler(grpcweb.ReflectionMethodPath, refl.Handler())
func NewReflection(transport *Transport) *Reflection {
	return reflection.New(transport)
}

// RegisterReflection is a convenience function that creates and registers
// reflection handlers on the transport.
//
// Example:
//
//	transport := grpcweb.NewTransport(dataChannel, nil)
//	grpcweb.RegisterReflection(transport)
func RegisterReflection(transport *Transport) *Reflection {
	refl := reflection.New(transport)
	transport.RegisterHandler(reflection.MethodPath, refl.Handler())
	transport.RegisterHandler(reflection.FileContainingSymbolPath, refl.FileContainingSymbolHandler())
	return refl
}
