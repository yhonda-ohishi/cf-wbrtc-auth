package transport_test

import (
	"context"
	"fmt"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/transport"
	"github.com/pion/webrtc/v4"
)

// Example message types for demonstration
type PrintRequest struct {
	DocumentID string
	Pages      int32
}

type PrintResponse struct {
	JobID  string
	Status string
}

// Example serialization functions (would typically use protobuf)
func deserializePrintRequest(data []byte) (*PrintRequest, error) {
	// In real code, use proto.Unmarshal
	// For this example, we just create a dummy request
	return &PrintRequest{DocumentID: "doc123", Pages: 5}, nil
}

func serializePrintResponse(resp *PrintResponse) ([]byte, error) {
	// In real code, use proto.Marshal
	// For this example, return dummy data
	return []byte(fmt.Sprintf("JobID:%s,Status:%s", resp.JobID, resp.Status)), nil
}

// Example: Basic handler registration and usage
func ExampleDataChannelTransport_basic() {
	// Create a mock data channel (in real usage, this comes from WebRTC peer connection)
	var dc *webrtc.DataChannel // would be created from peer connection

	// Create transport with default options
	transport := transport.NewDataChannelTransport(dc, nil)

	// Register a simple handler
	transport.RegisterHandler("/print.PrintService/Print", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		// Process the request
		// req.Message contains the protobuf-encoded request
		// req.Headers contains metadata like "x-request-id"

		// Return success response
		return &codec.ResponseEnvelope{
			Headers:  map[string]string{},
			Messages: [][]byte{[]byte("response data")},
			Trailers: map[string]string{
				"grpc-status": "0",
			},
		}, nil
	})

	// Start listening for requests
	transport.Start()

	// When done, close the transport
	defer transport.Close()
}

// Example: Using MakeHandler for typed handlers
func ExampleMakeHandler() {
	var dc *webrtc.DataChannel // would be created from peer connection

	trans := transport.NewDataChannelTransport(dc, nil)

	// Create a typed handler using MakeHandler
	printHandler := transport.MakeHandler(
		deserializePrintRequest,
		serializePrintResponse,
		func(ctx context.Context, req *PrintRequest) (*PrintResponse, error) {
			// Your business logic here
			// This is type-safe - no manual serialization needed

			// Check context deadline
			if deadline, ok := ctx.Deadline(); ok {
				fmt.Printf("Request must complete before: %v\n", deadline)
			}

			// Process the print request
			fmt.Printf("Printing document %s with %d pages\n", req.DocumentID, req.Pages)

			// Return typed response
			return &PrintResponse{
				JobID:  "job-123",
				Status: "queued",
			}, nil
		},
	)

	// Register the typed handler
	trans.RegisterHandler("/print.PrintService/Print", printHandler)

	trans.Start()
	defer trans.Close()
}

// Example: Error handling
func ExampleDataChannelTransport_errorHandling() {
	var dc *webrtc.DataChannel

	transport := transport.NewDataChannelTransport(dc, nil)

	transport.RegisterHandler("/print.PrintService/Print", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		// Return a gRPC error
		return nil, &codec.GRPCError{
			Code:    codec.StatusInvalidArgument,
			Message: "Invalid document format",
		}
	})

	transport.Start()
	defer transport.Close()
}

// Example: Custom timeout configuration
func ExampleDataChannelTransport_withTimeout() {
	var dc *webrtc.DataChannel

	// Configure custom timeout
	opts := &transport.HandlerOptions{
		Timeout: 60 * 1000000000, // 60 seconds in nanoseconds
	}

	transport := transport.NewDataChannelTransport(dc, opts)

	transport.RegisterHandler("/print.PrintService/Print", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		// The context will have the configured timeout
		select {
		case <-ctx.Done():
			return nil, &codec.GRPCError{
				Code:    codec.StatusDeadlineExceeded,
				Message: "Request timed out",
			}
		default:
			// Process request
		}

		return &codec.ResponseEnvelope{
			Headers:  map[string]string{},
			Messages: [][]byte{[]byte("response")},
			Trailers: map[string]string{
				"grpc-status": "0",
			},
		}, nil
	})

	transport.Start()
	defer transport.Close()
}

// Example: Handling x-request-id for request tracing
func ExampleDataChannelTransport_requestID() {
	var dc *webrtc.DataChannel

	transport := transport.NewDataChannelTransport(dc, nil)

	transport.RegisterHandler("/print.PrintService/Print", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		// The x-request-id header is automatically echoed in the response
		// You can also access it for logging
		if reqID, ok := req.Headers["x-request-id"]; ok {
			fmt.Printf("Processing request: %s\n", reqID)
		}

		return &codec.ResponseEnvelope{
			Headers:  map[string]string{},
			Messages: [][]byte{[]byte("response")},
			Trailers: map[string]string{
				"grpc-status": "0",
			},
		}, nil
	})

	transport.Start()
	defer transport.Close()
}

// Example: OnClose callback
func ExampleDataChannelTransport_onClose() {
	var dc *webrtc.DataChannel

	transport := transport.NewDataChannelTransport(dc, nil)

	// Set up close callback
	transport.OnClose(func() {
		fmt.Println("Transport closed, cleaning up resources...")
		// Clean up any resources, cancel ongoing operations, etc.
	})

	transport.Start()
	defer transport.Close()
}
