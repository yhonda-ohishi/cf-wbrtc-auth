// Package codec implements gRPC-Web frame encoding and decoding.
//
// Frame format:
// - 1 byte: flags (0 = data, 1 = trailer)
// - 4 bytes: big-endian message length
// - N bytes: message payload
package codec

import (
	"encoding/binary"
	"fmt"
	"strings"
)

const (
	// FrameData represents a data frame
	FrameData byte = 0x00
	// FrameTrailer represents a trailer frame
	FrameTrailer byte = 0x01
	// HeaderSize is the size of the frame header (1 byte flags + 4 bytes length)
	HeaderSize = 5
)

// Frame represents a gRPC-Web frame
type Frame struct {
	Flags byte
	Data  []byte
}

// EncodeFrame encodes a single frame into gRPC-Web format
func EncodeFrame(frame Frame) []byte {
	messageLength := len(frame.Data)
	buffer := make([]byte, HeaderSize+messageLength)

	// Write flags (1 byte)
	buffer[0] = frame.Flags

	// Write length in big-endian (4 bytes)
	binary.BigEndian.PutUint32(buffer[1:5], uint32(messageLength))

	// Write message data
	copy(buffer[HeaderSize:], frame.Data)

	return buffer
}

// DecodeResult contains the result of decoding frames
type DecodeResult struct {
	Frames    []Frame
	Remaining []byte
}

// DecodeFrames decodes frames from buffer (may contain multiple frames or partial frames).
// Returns decoded frames and any remaining bytes that don't form a complete frame.
func DecodeFrames(buffer []byte) DecodeResult {
	frames := []Frame{}
	offset := 0
	bufferLen := len(buffer)

	for offset < bufferLen {
		// Check if we have enough bytes for frame header
		if offset+HeaderSize > bufferLen {
			// Incomplete header, return remaining bytes
			return DecodeResult{
				Frames:    frames,
				Remaining: buffer[offset:],
			}
		}

		// Read flags
		flags := buffer[offset]

		// Read message length (big-endian)
		messageLength := binary.BigEndian.Uint32(buffer[offset+1 : offset+5])

		// Check if we have enough bytes for the complete message
		frameEnd := offset + HeaderSize + int(messageLength)
		if frameEnd > bufferLen {
			// Incomplete frame, return remaining bytes
			return DecodeResult{
				Frames:    frames,
				Remaining: buffer[offset:],
			}
		}

		// Extract frame data (make a copy to avoid referencing original buffer)
		data := make([]byte, messageLength)
		copy(data, buffer[offset+HeaderSize:frameEnd])

		frames = append(frames, Frame{
			Flags: flags,
			Data:  data,
		})

		offset = frameEnd
	}

	// All bytes consumed
	return DecodeResult{
		Frames:    frames,
		Remaining: []byte{},
	}
}

// CreateDataFrame creates a data frame
func CreateDataFrame(data []byte) Frame {
	return Frame{
		Flags: FrameData,
		Data:  data,
	}
}

// CreateTrailerFrame creates a trailer frame from headers.
// Trailers are encoded as HTTP/1.1 headers format:
// "key1: value1\r\nkey2: value2\r\n"
func CreateTrailerFrame(trailers map[string]string) Frame {
	lines := make([]string, 0, len(trailers))

	for key, value := range trailers {
		lines = append(lines, fmt.Sprintf("%s: %s", key, value))
	}

	trailerText := strings.Join(lines, "\r\n") + "\r\n"
	data := []byte(trailerText)

	return Frame{
		Flags: FrameTrailer,
		Data:  data,
	}
}

// ParseTrailers parses trailer frame data to headers.
// Expects HTTP/1.1 header format: "key1: value1\r\nkey2: value2\r\n"
func ParseTrailers(data []byte) map[string]string {
	text := string(data)
	trailers := make(map[string]string)

	// Split by CRLF
	lines := strings.Split(text, "\r\n")

	for _, line := range lines {
		// Skip empty lines
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		// Parse "key: value" format
		colonIndex := strings.Index(line, ":")
		if colonIndex == -1 {
			continue // Invalid header line, skip
		}

		key := strings.TrimSpace(strings.ToLower(line[:colonIndex]))
		value := strings.TrimSpace(line[colonIndex+1:])

		trailers[key] = value
	}

	return trailers
}
