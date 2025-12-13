// Package main demonstrates using grpcweb transport over WebRTC DataChannel.
//
// This example shows how to:
// 1. Set up a WebRTC connection
// 2. Create a grpcweb transport
// 3. Register handlers for RPC methods
// 4. Enable server reflection
//
// Note: This is a demonstration file and won't compile standalone.
// It requires the full project context and a WebRTC connection.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb"
	"github.com/pion/webrtc/v4"
)

// EchoRequest is an example request type
type EchoRequest struct {
	Message string `json:"message"`
}

// EchoResponse is an example response type
type EchoResponse struct {
	Reply string `json:"reply"`
}

// Example demonstrates setting up a grpcweb server over DataChannel
func Example(dataChannel *webrtc.DataChannel) {
	// Create the transport
	transport := grpcweb.NewTransport(dataChannel, nil)

	// Enable server reflection (optional but recommended)
	// This allows clients to discover available methods
	grpcweb.RegisterReflection(transport)

	// Register an Echo handler using MakeHandler for type safety
	echoHandler := grpcweb.MakeHandler(
		// Deserializer: converts bytes to request
		func(data []byte) (*EchoRequest, error) {
			var req EchoRequest
			if err := json.Unmarshal(data, &req); err != nil {
				return nil, err
			}
			return &req, nil
		},
		// Serializer: converts response to bytes
		func(resp *EchoResponse) ([]byte, error) {
			return json.Marshal(resp)
		},
		// Handler: business logic
		func(ctx context.Context, req *EchoRequest) (*EchoResponse, error) {
			return &EchoResponse{
				Reply: "Echo: " + req.Message,
			}, nil
		},
	)

	transport.RegisterHandler("/example.EchoService/Echo", echoHandler)

	// Register more handlers as needed
	transport.RegisterHandler("/example.EchoService/Reverse", createReverseHandler())

	// Set up close callback
	transport.OnClose(func() {
		log.Println("Transport closed")
	})

	// Start handling requests
	transport.Start()

	log.Println("gRPC-Web server started over DataChannel")
}

// createReverseHandler creates a handler that reverses the input message
func createReverseHandler() grpcweb.Handler {
	return grpcweb.MakeHandler(
		func(data []byte) (*EchoRequest, error) {
			var req EchoRequest
			if err := json.Unmarshal(data, &req); err != nil {
				return nil, err
			}
			return &req, nil
		},
		func(resp *EchoResponse) ([]byte, error) {
			return json.Marshal(resp)
		},
		func(ctx context.Context, req *EchoRequest) (*EchoResponse, error) {
			// Reverse the message
			runes := []rune(req.Message)
			for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
				runes[i], runes[j] = runes[j], runes[i]
			}
			return &EchoResponse{
				Reply: string(runes),
			}, nil
		},
	)
}

// ExampleWithErrorHandling shows how to return gRPC errors
func ExampleWithErrorHandling(dataChannel *webrtc.DataChannel) {
	transport := grpcweb.NewTransport(dataChannel, nil)

	// Handler that demonstrates error handling
	handler := grpcweb.MakeHandler(
		func(data []byte) (*EchoRequest, error) {
			var req EchoRequest
			if err := json.Unmarshal(data, &req); err != nil {
				return nil, err // Will be converted to INVALID_ARGUMENT
			}
			return &req, nil
		},
		func(resp *EchoResponse) ([]byte, error) {
			return json.Marshal(resp)
		},
		func(ctx context.Context, req *EchoRequest) (*EchoResponse, error) {
			// Validate input
			if req.Message == "" {
				// Return a gRPC error with specific code
				return nil, &grpcweb.GRPCError{
					Code:    grpcweb.StatusInvalidArgument,
					Message: "Message cannot be empty",
				}
			}

			// Check for forbidden words
			if req.Message == "forbidden" {
				return nil, &grpcweb.GRPCError{
					Code:    grpcweb.StatusPermissionDenied,
					Message: "This message is not allowed",
				}
			}

			return &EchoResponse{Reply: req.Message}, nil
		},
	)

	transport.RegisterHandler("/example.EchoService/ValidatedEcho", handler)
	transport.Start()
}

// ExampleRawHandler shows how to use raw handlers without MakeHandler
func ExampleRawHandler(dataChannel *webrtc.DataChannel) {
	transport := grpcweb.NewTransport(dataChannel, nil)

	// Raw handler with full control over request/response
	rawHandler := func(ctx context.Context, req *grpcweb.RequestEnvelope) (*grpcweb.ResponseEnvelope, error) {
		// Access headers
		if authHeader, ok := req.Headers["authorization"]; ok {
			log.Printf("Auth header: %s", authHeader)
		}

		// Process message
		response := fmt.Sprintf("Received %d bytes at path %s", len(req.Message), req.Path)

		return &grpcweb.ResponseEnvelope{
			Headers: map[string]string{
				"x-custom-header": "custom-value",
			},
			Messages: [][]byte{[]byte(response)},
			Trailers: map[string]string{
				"grpc-status": "0",
			},
		}, nil
	}

	transport.RegisterHandler("/example.RawService/Process", rawHandler)
	transport.Start()
}

func main() {
	// This is just for documentation purposes
	// In real usage, you would get the DataChannel from a WebRTC connection
	fmt.Println("See the Example functions for usage patterns")
}
