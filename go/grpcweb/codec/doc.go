// Package codec implements gRPC-Web frame encoding and decoding.
//
// The gRPC-Web protocol uses a simple framing format to transport messages:
//   - 1 byte: flags (0 = data, 1 = trailer)
//   - 4 bytes: big-endian message length
//   - N bytes: message payload
//
// This package provides functions to encode and decode frames, handle partial
// frames in streaming scenarios, and work with trailers in HTTP/1.1 header format.
//
// Example usage:
//
//	// Encoding
//	frame := codec.CreateDataFrame([]byte("message"))
//	encoded := codec.EncodeFrame(frame)
//
//	// Decoding
//	result := codec.DecodeFrames(buffer)
//	for _, frame := range result.Frames {
//	    // Process frame
//	}
//	buffer = result.Remaining // Keep for next iteration
//
// The decoder is designed to handle streaming scenarios where data arrives
// in chunks and may not contain complete frames.
package codec
