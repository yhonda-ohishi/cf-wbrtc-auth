// Package transport implements gRPC-Web transport over WebRTC DataChannel.
//
// This is the server-side transport that handles incoming gRPC-Web requests
// over WebRTC DataChannel and sends responses back.
package transport

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
	"github.com/pion/webrtc/v4"
)

// DataChannelInterface abstracts webrtc.DataChannel for testability
type DataChannelInterface interface {
	Send(data []byte) error
	Close() error
	OnMessage(f func(msg webrtc.DataChannelMessage))
	OnClose(f func())
	OnError(f func(err error))
}

// dataChannelAdapter adapts *webrtc.DataChannel to DataChannelInterface
type dataChannelAdapter struct {
	dc *webrtc.DataChannel
}

func (a *dataChannelAdapter) Send(data []byte) error {
	return a.dc.Send(data)
}

func (a *dataChannelAdapter) Close() error {
	return a.dc.Close()
}

func (a *dataChannelAdapter) OnMessage(f func(msg webrtc.DataChannelMessage)) {
	a.dc.OnMessage(f)
}

func (a *dataChannelAdapter) OnClose(f func()) {
	a.dc.OnClose(f)
}

func (a *dataChannelAdapter) OnError(f func(err error)) {
	a.dc.OnError(f)
}

// Handler handles a gRPC method call.
// It receives the request envelope and should return the response bytes and trailers.
type Handler func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error)

// HandlerOptions provides options for handling requests
type HandlerOptions struct {
	// Timeout is the request timeout, default 30s
	Timeout time.Duration
}

// DefaultHandlerOptions returns default handler options
func DefaultHandlerOptions() *HandlerOptions {
	return &HandlerOptions{
		Timeout: 30 * time.Second,
	}
}

// DataChannelTransport handles gRPC-Web over DataChannel (server side)
type DataChannelTransport struct {
	dc       DataChannelInterface
	handlers map[string]Handler
	mu       sync.RWMutex
	closed   bool
	options  *HandlerOptions
	onClose  func()
}

// NewDataChannelTransport creates a new transport from a DataChannel
func NewDataChannelTransport(dc *webrtc.DataChannel, opts *HandlerOptions) *DataChannelTransport {
	if opts == nil {
		opts = DefaultHandlerOptions()
	}

	return &DataChannelTransport{
		dc:       &dataChannelAdapter{dc: dc},
		handlers: make(map[string]Handler),
		closed:   false,
		options:  opts,
	}
}

// newDataChannelTransportWithInterface creates a transport from a DataChannelInterface
// This is primarily for testing purposes
func newDataChannelTransportWithInterface(dc DataChannelInterface, opts *HandlerOptions) *DataChannelTransport {
	if opts == nil {
		opts = DefaultHandlerOptions()
	}

	return &DataChannelTransport{
		dc:       dc,
		handlers: make(map[string]Handler),
		closed:   false,
		options:  opts,
	}
}

// RegisterHandler registers a handler for a method path.
// path should be in format "/package.Service/Method"
func (t *DataChannelTransport) RegisterHandler(path string, handler Handler) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.handlers[path] = handler
}

// UnregisterHandler removes a handler
func (t *DataChannelTransport) UnregisterHandler(path string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.handlers, path)
}

// OnClose sets a callback to be called when the transport is closed
func (t *DataChannelTransport) OnClose(callback func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.onClose = callback
}

// Start begins listening for incoming requests.
// This should be called after all handlers are registered.
func (t *DataChannelTransport) Start() {
	t.dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		t.handleMessage(msg.Data)
	})

	t.dc.OnClose(func() {
		t.mu.Lock()
		t.closed = true
		onClose := t.onClose
		t.mu.Unlock()

		if onClose != nil {
			onClose()
		}
	})

	t.dc.OnError(func(err error) {
		log.Printf("DataChannel error: %v", err)
	})
}

// handleMessage processes an incoming request message
func (t *DataChannelTransport) handleMessage(data []byte) {
	// Decode the request envelope
	req, err := codec.DecodeRequest(data)
	if err != nil {
		log.Printf("Failed to decode request: %v", err)
		// Send error response
		errResp := codec.CreateErrorResponse(codec.StatusInvalidArgument, fmt.Sprintf("Failed to decode request: %v", err))
		if err := t.SendResponse(&errResp); err != nil {
			log.Printf("Failed to send error response: %v", err)
		}
		return
	}

	// Look up handler
	t.mu.RLock()
	handler, ok := t.handlers[req.Path]
	t.mu.RUnlock()

	if !ok {
		log.Printf("No handler registered for path: %s", req.Path)
		// Send UNIMPLEMENTED error
		errResp := codec.CreateErrorResponse(codec.StatusUnimplemented, fmt.Sprintf("Method %s is not implemented", req.Path))
		// Echo x-request-id if present
		if reqID, ok := req.Headers["x-request-id"]; ok {
			errResp.Headers["x-request-id"] = reqID
		}
		if err := t.SendResponse(&errResp); err != nil {
			log.Printf("Failed to send error response: %v", err)
		}
		return
	}

	// Create context with timeout
	ctx := context.Background()
	if t.options.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, t.options.Timeout)
		defer cancel()
	}

	// Call the handler
	resp, err := handler(ctx, req)
	if err != nil {
		log.Printf("Handler error for %s: %v", req.Path, err)
		// Convert error to gRPC error response
		var errResp codec.ResponseEnvelope
		if grpcErr, ok := err.(*codec.GRPCError); ok {
			errResp = codec.CreateErrorResponse(grpcErr.Code, grpcErr.Message)
		} else {
			errResp = codec.CreateErrorResponse(codec.StatusInternal, err.Error())
		}
		// Echo x-request-id if present
		if reqID, ok := req.Headers["x-request-id"]; ok {
			errResp.Headers["x-request-id"] = reqID
		}
		if err := t.SendResponse(&errResp); err != nil {
			log.Printf("Failed to send error response: %v", err)
		}
		return
	}

	// Echo x-request-id from request to response
	if reqID, ok := req.Headers["x-request-id"]; ok {
		if resp.Headers == nil {
			resp.Headers = make(map[string]string)
		}
		resp.Headers["x-request-id"] = reqID
	}

	// Ensure trailers have grpc-status if not set
	if resp.Trailers == nil {
		resp.Trailers = make(map[string]string)
	}
	if _, ok := resp.Trailers["grpc-status"]; !ok {
		resp.Trailers["grpc-status"] = strconv.Itoa(codec.StatusOK)
	}

	// Send the response
	if err := t.SendResponse(resp); err != nil {
		log.Printf("Failed to send response: %v", err)
	}
}

// SendResponse sends a response (used internally or for async responses)
func (t *DataChannelTransport) SendResponse(envelope *codec.ResponseEnvelope) error {
	t.mu.RLock()
	if t.closed {
		t.mu.RUnlock()
		return fmt.Errorf("transport is closed")
	}
	t.mu.RUnlock()

	// Encode the response
	data, err := codec.EncodeResponse(*envelope)
	if err != nil {
		return fmt.Errorf("failed to encode response: %w", err)
	}

	// Send over DataChannel
	return t.dc.Send(data)
}

// Close closes the transport and data channel
func (t *DataChannelTransport) Close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	onClose := t.onClose
	t.mu.Unlock()

	if onClose != nil {
		onClose()
	}

	return t.dc.Close()
}

// MakeHandler creates a Handler from typed serialization functions.
//
// This helper makes it easier to create handlers with typed request/response
// without manually dealing with byte slices and envelopes.
//
// Example:
//
//	handler := MakeHandler(
//	    func(data []byte) (*pb.Request, error) {
//	        req := &pb.Request{}
//	        err := proto.Unmarshal(data, req)
//	        return req, err
//	    },
//	    func(resp *pb.Response) ([]byte, error) {
//	        return proto.Marshal(resp)
//	    },
//	    func(ctx context.Context, req *pb.Request) (*pb.Response, error) {
//	        // Your business logic here
//	        return &pb.Response{...}, nil
//	    },
//	)
func MakeHandler[Req, Resp any](
	deserialize func([]byte) (Req, error),
	serialize func(Resp) ([]byte, error),
	handle func(ctx context.Context, req Req) (Resp, error),
) Handler {
	return func(ctx context.Context, reqEnv *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		// Deserialize request
		req, err := deserialize(reqEnv.Message)
		if err != nil {
			return nil, &codec.GRPCError{
				Code:    codec.StatusInvalidArgument,
				Message: fmt.Sprintf("Failed to deserialize request: %v", err),
			}
		}

		// Call handler
		resp, err := handle(ctx, req)
		if err != nil {
			// If it's already a GRPCError, return it
			if grpcErr, ok := err.(*codec.GRPCError); ok {
				return nil, grpcErr
			}
			// Otherwise, wrap it as INTERNAL error
			return nil, &codec.GRPCError{
				Code:    codec.StatusInternal,
				Message: err.Error(),
			}
		}

		// Serialize response
		respData, err := serialize(resp)
		if err != nil {
			return nil, &codec.GRPCError{
				Code:    codec.StatusInternal,
				Message: fmt.Sprintf("Failed to serialize response: %v", err),
			}
		}

		// Create response envelope
		return &codec.ResponseEnvelope{
			Headers:  make(map[string]string),
			Messages: [][]byte{respData},
			Trailers: map[string]string{
				"grpc-status": strconv.Itoa(codec.StatusOK),
			},
		}, nil
	}
}
