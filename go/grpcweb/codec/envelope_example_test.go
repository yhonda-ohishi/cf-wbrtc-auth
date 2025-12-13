package codec_test

import (
	"fmt"
	"log"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
)

// Example of encoding and decoding a gRPC-Web request
func ExampleEncodeRequest() {
	// Create a request envelope
	request := codec.RequestEnvelope{
		Path: "/myservice.MyService/MyMethod",
		Headers: map[string]string{
			"content-type":  "application/grpc-web+proto",
			"authorization": "Bearer my-token",
		},
		Message: []byte("serialized protobuf message"),
	}

	// Encode the request
	encoded, err := codec.EncodeRequest(request)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Encoded request size: %d bytes\n", len(encoded))
	// Output: Encoded request size: 148 bytes
}

// Example of decoding a gRPC-Web request
func ExampleDecodeRequest() {
	// Simulate receiving an encoded request
	request := codec.RequestEnvelope{
		Path:    "/myservice.MyService/MyMethod",
		Headers: map[string]string{"content-type": "application/grpc-web+proto"},
		Message: []byte("test message"),
	}
	encoded, _ := codec.EncodeRequest(request)

	// Decode the request
	decoded, err := codec.DecodeRequest(encoded)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Path: %s\n", decoded.Path)
	fmt.Printf("Message: %s\n", string(decoded.Message))
	// Output:
	// Path: /myservice.MyService/MyMethod
	// Message: test message
}

// Example of encoding and decoding a gRPC-Web response
func ExampleEncodeResponse() {
	// Create a successful response
	response := codec.ResponseEnvelope{
		Headers: map[string]string{
			"content-type": "application/grpc-web+proto",
		},
		Messages: [][]byte{
			[]byte("response message 1"),
			[]byte("response message 2"),
		},
		Trailers: map[string]string{
			"grpc-status":  "0",
			"grpc-message": "OK",
		},
	}

	// Encode the response
	encoded, err := codec.EncodeResponse(response)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Encoded response size: %d bytes\n", len(encoded))
	// Output: Encoded response size: 134 bytes
}

// Example of decoding a gRPC-Web response
func ExampleDecodeResponse() {
	// Simulate receiving an encoded response
	response := codec.ResponseEnvelope{
		Headers:  map[string]string{"content-type": "application/grpc-web+proto"},
		Messages: [][]byte{[]byte("hello world")},
		Trailers: map[string]string{"grpc-status": "0"},
	}
	encoded, _ := codec.EncodeResponse(response)

	// Decode the response
	decoded, err := codec.DecodeResponse(encoded)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Messages: %d\n", len(decoded.Messages))
	fmt.Printf("First message: %s\n", string(decoded.Messages[0]))
	fmt.Printf("Status: %s\n", decoded.Trailers["grpc-status"])
	// Output:
	// Messages: 1
	// First message: hello world
	// Status: 0
}

// Example of creating an error response
func ExampleCreateErrorResponse() {
	// Create an error response
	errorResponse := codec.CreateErrorResponse(
		codec.StatusNotFound,
		"The requested resource was not found",
	)

	// Encode and decode to verify
	encoded, _ := codec.EncodeResponse(errorResponse)
	decoded, _ := codec.DecodeResponse(encoded)

	// Check if it's an error
	if codec.IsErrorResponse(*decoded) {
		err := codec.GetError(*decoded)
		fmt.Printf("Error: %s\n", err.Error())
	}
	// Output: Error: gRPC error 5 (NOT_FOUND): The requested resource was not found
}

// Example of checking for errors in a response
func ExampleIsErrorResponse() {
	// Create an error response
	errorResponse := codec.ResponseEnvelope{
		Headers:  map[string]string{},
		Messages: [][]byte{},
		Trailers: map[string]string{
			"grpc-status":  "13",
			"grpc-message": "Internal server error",
		},
	}

	// Check if response is an error
	if codec.IsErrorResponse(errorResponse) {
		fmt.Println("Response contains an error")
		err := codec.GetError(errorResponse)
		fmt.Printf("Code: %d, Message: %s\n", err.Code, err.Message)
	}
	// Output:
	// Response contains an error
	// Code: 13, Message: Internal server error
}

// Example of getting status code names
func ExampleGetStatusName() {
	// Get names for various status codes
	codes := []int{
		codec.StatusOK,
		codec.StatusNotFound,
		codec.StatusInternal,
		codec.StatusUnauthenticated,
	}

	for _, code := range codes {
		fmt.Printf("%d: %s\n", code, codec.GetStatusName(code))
	}
	// Output:
	// 0: OK
	// 5: NOT_FOUND
	// 13: INTERNAL
	// 16: UNAUTHENTICATED
}

// Example of a complete request-response flow
func Example_completeFlow() {
	// 1. Client creates and encodes a request
	request := codec.RequestEnvelope{
		Path:    "/api.v1.UserService/GetUser",
		Headers: map[string]string{"authorization": "Bearer token123"},
		Message: []byte("user_id: 42"),
	}
	requestData, _ := codec.EncodeRequest(request)

	// 2. Server receives and decodes the request
	decodedRequest, _ := codec.DecodeRequest(requestData)
	fmt.Printf("Received request for: %s\n", decodedRequest.Path)

	// 3. Server processes and creates a response
	response := codec.ResponseEnvelope{
		Headers:  map[string]string{"content-type": "application/grpc-web+proto"},
		Messages: [][]byte{[]byte("user: {name: 'John', id: 42}")},
		Trailers: map[string]string{"grpc-status": "0", "grpc-message": "OK"},
	}
	responseData, _ := codec.EncodeResponse(response)

	// 4. Client receives and decodes the response
	decodedResponse, _ := codec.DecodeResponse(responseData)
	if !codec.IsErrorResponse(*decodedResponse) {
		fmt.Printf("Success: %s\n", string(decodedResponse.Messages[0]))
	}
	// Output:
	// Received request for: /api.v1.UserService/GetUser
	// Success: user: {name: 'John', id: 42}
}

// Example of handling streaming responses
func Example_streamingResponse() {
	// Server sends multiple messages in a streaming response
	response := codec.ResponseEnvelope{
		Headers: map[string]string{"content-type": "application/grpc-web+proto"},
		Messages: [][]byte{
			[]byte("message 1"),
			[]byte("message 2"),
			[]byte("message 3"),
		},
		Trailers: map[string]string{"grpc-status": "0"},
	}

	// Encode and decode
	encoded, _ := codec.EncodeResponse(response)
	decoded, _ := codec.DecodeResponse(encoded)

	// Process each message
	fmt.Printf("Received %d messages:\n", len(decoded.Messages))
	for i, msg := range decoded.Messages {
		fmt.Printf("  %d: %s\n", i+1, string(msg))
	}
	// Output:
	// Received 3 messages:
	//   1: message 1
	//   2: message 2
	//   3: message 3
}
