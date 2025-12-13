package codec_test

import (
	"fmt"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
)

func ExampleEncodeFrame() {
	// Create a data frame with a message
	frame := codec.CreateDataFrame([]byte("Hello, gRPC-Web!"))

	// Encode the frame
	encoded := codec.EncodeFrame(frame)

	fmt.Printf("Encoded frame size: %d bytes\n", len(encoded))
	fmt.Printf("Frame header size: %d bytes\n", codec.HeaderSize)
	// Output:
	// Encoded frame size: 21 bytes
	// Frame header size: 5 bytes
}

func ExampleDecodeFrames() {
	// Simulate receiving data over the network
	data := []byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e', 'l', 'l', 'o'}

	// Decode frames
	result := codec.DecodeFrames(data)

	fmt.Printf("Decoded %d frame(s)\n", len(result.Frames))
	if len(result.Frames) > 0 {
		fmt.Printf("First frame data: %s\n", string(result.Frames[0].Data))
	}
	fmt.Printf("Remaining bytes: %d\n", len(result.Remaining))
	// Output:
	// Decoded 1 frame(s)
	// First frame data: hello
	// Remaining bytes: 0
}

func ExampleDecodeFrames_partial() {
	// Simulate receiving partial data
	partialData := []byte{0x00, 0x00, 0x00}

	// Decode frames
	result := codec.DecodeFrames(partialData)

	fmt.Printf("Decoded %d frame(s)\n", len(result.Frames))
	fmt.Printf("Remaining bytes: %d\n", len(result.Remaining))
	// Output:
	// Decoded 0 frame(s)
	// Remaining bytes: 3
}

func ExampleCreateTrailerFrame() {
	// Create trailers
	trailers := map[string]string{
		"grpc-status":  "0",
		"grpc-message": "OK",
	}

	// Create trailer frame
	frame := codec.CreateTrailerFrame(trailers)

	// Encode it
	encoded := codec.EncodeFrame(frame)

	fmt.Printf("Trailer frame flags: 0x%02x\n", frame.Flags)
	fmt.Printf("Encoded frame contains header and data\n")
	fmt.Printf("Frame is encoded: %t\n", len(encoded) > codec.HeaderSize)
	// Output:
	// Trailer frame flags: 0x01
	// Encoded frame contains header and data
	// Frame is encoded: true
}

func ExampleParseTrailers() {
	// Raw trailer data in HTTP/1.1 header format
	trailerData := []byte("grpc-status: 0\r\ngrpc-message: Success\r\n")

	// Parse trailers
	trailers := codec.ParseTrailers(trailerData)

	fmt.Printf("grpc-status: %s\n", trailers["grpc-status"])
	fmt.Printf("grpc-message: %s\n", trailers["grpc-message"])
	// Output:
	// grpc-status: 0
	// grpc-message: Success
}

func Example_streamProcessing() {
	// Simulate processing a stream of data that arrives in chunks
	var buffer []byte

	// First chunk: partial header
	chunk1 := []byte{0x00, 0x00}
	buffer = append(buffer, chunk1...)
	result := codec.DecodeFrames(buffer)
	fmt.Printf("After chunk 1: %d frames, %d remaining\n", len(result.Frames), len(result.Remaining))
	buffer = result.Remaining

	// Second chunk: rest of header + partial data
	chunk2 := []byte{0x00, 0x00, 0x05, 'h', 'e'}
	buffer = append(buffer, chunk2...)
	result = codec.DecodeFrames(buffer)
	fmt.Printf("After chunk 2: %d frames, %d remaining\n", len(result.Frames), len(result.Remaining))
	buffer = result.Remaining

	// Third chunk: rest of data
	chunk3 := []byte{'l', 'l', 'o'}
	buffer = append(buffer, chunk3...)
	result = codec.DecodeFrames(buffer)
	fmt.Printf("After chunk 3: %d frames, %d remaining\n", len(result.Frames), len(result.Remaining))
	if len(result.Frames) > 0 {
		fmt.Printf("Message: %s\n", string(result.Frames[0].Data))
	}

	// Output:
	// After chunk 1: 0 frames, 2 remaining
	// After chunk 2: 0 frames, 7 remaining
	// After chunk 3: 1 frames, 0 remaining
	// Message: hello
}
