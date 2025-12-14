// Package codec implements gRPC-Web envelope encoding and decoding.
//
// Handles the higher-level gRPC-Web message envelope format which wraps
// the RPC call structure. This includes routing info (path, headers) and
// uses the Frame codec for the actual gRPC-Web framing.
//
// Request format over DataChannel:
// - 4 bytes: path length (big-endian)
// - N bytes: path string (UTF-8)
// - 4 bytes: headers length (big-endian)
// - M bytes: headers as JSON string
// - Rest: gRPC-Web frames (data frames containing the message)
//
// Response format:
// - 4 bytes: headers length (big-endian)
// - N bytes: headers as JSON string
// - Rest: gRPC-Web frames (data frames + trailer frame)
package codec

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

// StatusCode represents gRPC status codes
const (
	StatusOK                 = 0
	StatusCancelled          = 1
	StatusUnknown            = 2
	StatusInvalidArgument    = 3
	StatusDeadlineExceeded   = 4
	StatusNotFound           = 5
	StatusAlreadyExists      = 6
	StatusPermissionDenied   = 7
	StatusResourceExhausted  = 8
	StatusFailedPrecondition = 9
	StatusAborted            = 10
	StatusOutOfRange         = 11
	StatusUnimplemented      = 12
	StatusInternal           = 13
	StatusUnavailable        = 14
	StatusDataLoss           = 15
	StatusUnauthenticated    = 16
)

// RequestEnvelope is sent from client to server
type RequestEnvelope struct {
	Path    string            // Full method path, e.g., "/package.Service/Method"
	Headers map[string]string // Request headers (metadata)
	Message []byte            // Serialized protobuf message
}

// ResponseEnvelope is received from server
type ResponseEnvelope struct {
	Headers  map[string]string // Response headers
	Messages [][]byte          // Serialized protobuf messages (can be multiple for streaming)
	Trailers map[string]string // Response trailers (contains grpc-status, grpc-message)
}

// GRPCError represents a gRPC error with code and message
type GRPCError struct {
	Code    int
	Message string
}

// Error implements the error interface
func (e *GRPCError) Error() string {
	return fmt.Sprintf("gRPC error %d (%s): %s", e.Code, GetStatusName(e.Code), e.Message)
}

// EncodeRequest encodes a request envelope for sending over DataChannel
// Format: [path_len(4)][path(N)][headers_len(4)][headers_json(M)][grpc_frames]
func EncodeRequest(envelope RequestEnvelope) ([]byte, error) {
	// Encode path
	pathBytes := []byte(envelope.Path)
	pathLength := len(pathBytes)

	// Encode headers as JSON
	headersJSON, err := json.Marshal(envelope.Headers)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal headers: %w", err)
	}
	headersLength := len(headersJSON)

	// Create gRPC-Web data frame for the message
	dataFrame := CreateDataFrame(envelope.Message)
	frameBytes := EncodeFrame(dataFrame)

	// Calculate total length
	totalLength := 4 + pathLength + 4 + headersLength + len(frameBytes)

	// Allocate buffer
	buffer := make([]byte, totalLength)
	offset := 0

	// Write path length (big-endian)
	binary.BigEndian.PutUint32(buffer[offset:offset+4], uint32(pathLength))
	offset += 4

	// Write path
	copy(buffer[offset:offset+pathLength], pathBytes)
	offset += pathLength

	// Write headers length (big-endian)
	binary.BigEndian.PutUint32(buffer[offset:offset+4], uint32(headersLength))
	offset += 4

	// Write headers
	copy(buffer[offset:offset+headersLength], headersJSON)
	offset += headersLength

	// Write gRPC-Web frames
	copy(buffer[offset:], frameBytes)

	return buffer, nil
}

// DecodeRequest decodes a request envelope received from DataChannel
func DecodeRequest(data []byte) (*RequestEnvelope, error) {
	if len(data) < 8 {
		return nil, errors.New("incomplete request: data too short")
	}

	offset := 0

	// Read path length
	pathLength := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	// Read path
	if offset+int(pathLength) > len(data) {
		return nil, errors.New("incomplete request: missing path")
	}
	path := string(data[offset : offset+int(pathLength)])
	offset += int(pathLength)

	// Read headers length
	if offset+4 > len(data) {
		return nil, errors.New("incomplete request: missing headers length")
	}
	headersLength := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	// Read headers
	if offset+int(headersLength) > len(data) {
		return nil, errors.New("incomplete request: missing headers")
	}
	headersJSON := data[offset : offset+int(headersLength)]
	offset += int(headersLength)

	var headers map[string]string
	if err := json.Unmarshal(headersJSON, &headers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal headers: %w", err)
	}

	// Decode gRPC-Web frames
	framesData := data[offset:]
	result := DecodeFrames(framesData)

	if len(result.Remaining) > 0 {
		return nil, errors.New("incomplete request: partial frame remaining")
	}

	// Extract message from data frames
	// For requests, we expect exactly one data frame
	if len(result.Frames) == 0 {
		return nil, errors.New("no data frames in request")
	}

	var message []byte
	for _, frame := range result.Frames {
		if frame.Flags == FrameData {
			// Take the first data frame as the message
			if message == nil {
				message = frame.Data
			}
		} else {
			return nil, fmt.Errorf("unexpected frame type in request: %d", frame.Flags)
		}
	}

	if message == nil {
		return nil, errors.New("no message data found in request")
	}

	return &RequestEnvelope{
		Path:    path,
		Headers: headers,
		Message: message,
	}, nil
}

// EncodeResponse encodes a response envelope for sending over DataChannel
// Format: [headers_len(4)][headers_json(N)][data_frames...][trailer_frame]
func EncodeResponse(envelope ResponseEnvelope) ([]byte, error) {
	// Encode headers as JSON
	headersJSON, err := json.Marshal(envelope.Headers)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal headers: %w", err)
	}
	headersLength := len(headersJSON)

	// Encode data frames
	dataFrameBytes := make([][]byte, 0, len(envelope.Messages))
	dataFramesLength := 0

	for _, message := range envelope.Messages {
		dataFrame := CreateDataFrame(message)
		frameBytes := EncodeFrame(dataFrame)
		dataFrameBytes = append(dataFrameBytes, frameBytes)
		dataFramesLength += len(frameBytes)
	}

	// Encode trailer frame
	trailerFrame := CreateTrailerFrame(envelope.Trailers)
	trailerBytes := EncodeFrame(trailerFrame)

	// Calculate total length
	totalLength := 4 + headersLength + dataFramesLength + len(trailerBytes)

	// Allocate buffer
	buffer := make([]byte, totalLength)
	offset := 0

	// Write headers length (big-endian)
	binary.BigEndian.PutUint32(buffer[offset:offset+4], uint32(headersLength))
	offset += 4

	// Write headers
	copy(buffer[offset:offset+headersLength], headersJSON)
	offset += headersLength

	// Write data frames
	for _, frameBytes := range dataFrameBytes {
		copy(buffer[offset:offset+len(frameBytes)], frameBytes)
		offset += len(frameBytes)
	}

	// Write trailer frame
	copy(buffer[offset:], trailerBytes)

	return buffer, nil
}

// DecodeResponse decodes a response envelope received from DataChannel
func DecodeResponse(data []byte) (*ResponseEnvelope, error) {
	if len(data) < 4 {
		return nil, errors.New("incomplete response: data too short")
	}

	offset := 0

	// Read headers length
	headersLength := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	// Read headers
	if offset+int(headersLength) > len(data) {
		return nil, errors.New("incomplete response: missing headers")
	}
	headersJSON := data[offset : offset+int(headersLength)]
	offset += int(headersLength)

	var headers map[string]string
	if err := json.Unmarshal(headersJSON, &headers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal headers: %w", err)
	}

	// Decode gRPC-Web frames
	framesData := data[offset:]
	result := DecodeFrames(framesData)

	if len(result.Remaining) > 0 {
		return nil, errors.New("incomplete response: partial frame remaining")
	}

	// Separate data frames and trailer frame
	messages := make([][]byte, 0)
	trailers := make(map[string]string)

	for _, frame := range result.Frames {
		if frame.Flags == FrameData {
			messages = append(messages, frame.Data)
		} else if frame.Flags == FrameTrailer {
			trailers = ParseTrailers(frame.Data)
		} else {
			return nil, fmt.Errorf("unknown frame flags: %d", frame.Flags)
		}
	}

	return &ResponseEnvelope{
		Headers:  headers,
		Messages: messages,
		Trailers: trailers,
	}, nil
}

// CreateErrorResponse creates an error response envelope
//
// This is useful for creating error responses on the server side
// or simulating errors on the client side for testing.
func CreateErrorResponse(code int, message string) ResponseEnvelope {
	trailers := map[string]string{
		"grpc-status":  strconv.Itoa(code),
		"grpc-message": message,
	}

	return ResponseEnvelope{
		Headers:  map[string]string{},
		Messages: [][]byte{},
		Trailers: trailers,
	}
}

// IsErrorResponse checks if a response is an error
func IsErrorResponse(envelope ResponseEnvelope) bool {
	status, ok := envelope.Trailers["grpc-status"]
	if !ok {
		return false
	}

	code, err := strconv.Atoi(status)
	if err != nil {
		return false
	}

	return code != StatusOK
}

// GetError extracts error details from a response envelope
func GetError(envelope ResponseEnvelope) *GRPCError {
	if !IsErrorResponse(envelope) {
		return nil
	}

	codeStr := envelope.Trailers["grpc-status"]
	code, err := strconv.Atoi(codeStr)
	if err != nil {
		code = StatusUnknown
	}

	message := envelope.Trailers["grpc-message"]
	if message == "" {
		message = "Unknown error"
	}

	return &GRPCError{
		Code:    code,
		Message: message,
	}
}

// GetStatusName returns the status name for a code
func GetStatusName(code int) string {
	switch code {
	case StatusOK:
		return "OK"
	case StatusCancelled:
		return "CANCELLED"
	case StatusUnknown:
		return "UNKNOWN"
	case StatusInvalidArgument:
		return "INVALID_ARGUMENT"
	case StatusDeadlineExceeded:
		return "DEADLINE_EXCEEDED"
	case StatusNotFound:
		return "NOT_FOUND"
	case StatusAlreadyExists:
		return "ALREADY_EXISTS"
	case StatusPermissionDenied:
		return "PERMISSION_DENIED"
	case StatusResourceExhausted:
		return "RESOURCE_EXHAUSTED"
	case StatusFailedPrecondition:
		return "FAILED_PRECONDITION"
	case StatusAborted:
		return "ABORTED"
	case StatusOutOfRange:
		return "OUT_OF_RANGE"
	case StatusUnimplemented:
		return "UNIMPLEMENTED"
	case StatusInternal:
		return "INTERNAL"
	case StatusUnavailable:
		return "UNAVAILABLE"
	case StatusDataLoss:
		return "DATA_LOSS"
	case StatusUnauthenticated:
		return "UNAUTHENTICATED"
	default:
		return "UNKNOWN"
	}
}

// Stream message flags for streaming RPC over DataChannel
const (
	// StreamFlagData indicates a data message in the stream
	StreamFlagData byte = 0x00
	// StreamFlagEnd indicates the final message with trailers
	StreamFlagEnd byte = 0x01
)

// StreamMessage represents a single message in a streaming RPC
type StreamMessage struct {
	RequestID string // Correlates stream messages to the original request
	Flag      byte   // StreamFlagData or StreamFlagEnd
	Data      []byte // Frame data (data frame or trailer frame)
}

// EncodeStreamMessage encodes a stream message for sending over DataChannel
// Format: [requestId_len(4)][requestId(N)][flag(1)][data...]
func EncodeStreamMessage(msg StreamMessage) []byte {
	requestIDBytes := []byte(msg.RequestID)
	requestIDLen := len(requestIDBytes)

	totalLen := 4 + requestIDLen + 1 + len(msg.Data)
	buffer := make([]byte, totalLen)
	offset := 0

	// Write request ID length
	binary.BigEndian.PutUint32(buffer[offset:offset+4], uint32(requestIDLen))
	offset += 4

	// Write request ID
	copy(buffer[offset:offset+requestIDLen], requestIDBytes)
	offset += requestIDLen

	// Write flag
	buffer[offset] = msg.Flag
	offset++

	// Write data
	copy(buffer[offset:], msg.Data)

	return buffer
}

// DecodeStreamMessage decodes a stream message received from DataChannel
func DecodeStreamMessage(data []byte) (*StreamMessage, error) {
	if len(data) < 5 {
		return nil, errors.New("stream message too short")
	}

	offset := 0

	// Read request ID length
	requestIDLen := binary.BigEndian.Uint32(data[offset : offset+4])
	offset += 4

	if offset+int(requestIDLen)+1 > len(data) {
		return nil, errors.New("incomplete stream message")
	}

	// Read request ID
	requestID := string(data[offset : offset+int(requestIDLen)])
	offset += int(requestIDLen)

	// Read flag
	flag := data[offset]
	offset++

	// Read data
	msgData := data[offset:]

	return &StreamMessage{
		RequestID: requestID,
		Flag:      flag,
		Data:      msgData,
	}, nil
}

// IsStreamMessage checks if data is a stream message (starts with request ID length)
// Regular responses start with headers length which is typically small JSON
// Stream messages have a specific pattern we can detect
func IsStreamMessage(data []byte) bool {
	if len(data) < 5 {
		return false
	}
	// Check if first 4 bytes represent a reasonable request ID length (< 256)
	// and the data after request ID starts with a valid stream flag
	requestIDLen := binary.BigEndian.Uint32(data[0:4])
	if requestIDLen == 0 || requestIDLen > 255 {
		return false
	}
	if int(4+requestIDLen+1) > len(data) {
		return false
	}
	flag := data[4+requestIDLen]
	return flag == StreamFlagData || flag == StreamFlagEnd
}
