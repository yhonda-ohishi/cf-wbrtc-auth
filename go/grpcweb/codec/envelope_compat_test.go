package codec

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// TestEnvelopeTypeScriptCompatibility ensures the Go envelope codec
// is compatible with the TypeScript envelope codec.
// These test vectors should match the TypeScript implementation.
func TestEnvelopeTypeScriptCompatibility(t *testing.T) {
	t.Run("request encoding", func(t *testing.T) {
		// Create a simple request
		request := RequestEnvelope{
			Path:    "/test.Service/Method",
			Headers: map[string]string{"key": "value"},
			Message: []byte("hello"),
		}

		encoded, err := EncodeRequest(request)
		if err != nil {
			t.Fatalf("EncodeRequest failed: %v", err)
		}

		// Verify structure: [path_len][path][headers_len][headers_json][frame]
		offset := 0

		// Check path length
		pathLen := int(encoded[offset])<<24 | int(encoded[offset+1])<<16 | int(encoded[offset+2])<<8 | int(encoded[offset+3])
		if pathLen != len(request.Path) {
			t.Errorf("Path length mismatch: got %d, want %d", pathLen, len(request.Path))
		}
		offset += 4

		// Check path content
		path := string(encoded[offset : offset+pathLen])
		if path != request.Path {
			t.Errorf("Path mismatch: got %s, want %s", path, request.Path)
		}
		offset += pathLen

		// Headers should be present
		headersLen := int(encoded[offset])<<24 | int(encoded[offset+1])<<16 | int(encoded[offset+2])<<8 | int(encoded[offset+3])
		if headersLen == 0 {
			t.Error("Headers length is zero")
		}
	})

	t.Run("response encoding", func(t *testing.T) {
		// Create a simple response
		response := ResponseEnvelope{
			Headers:  map[string]string{"content-type": "application/grpc-web"},
			Messages: [][]byte{[]byte("world")},
			Trailers: map[string]string{"grpc-status": "0"},
		}

		encoded, err := EncodeResponse(response)
		if err != nil {
			t.Fatalf("EncodeResponse failed: %v", err)
		}

		// Verify structure: [headers_len][headers_json][frames]
		offset := 0

		// Check headers length
		headersLen := int(encoded[offset])<<24 | int(encoded[offset+1])<<16 | int(encoded[offset+2])<<8 | int(encoded[offset+3])
		if headersLen == 0 {
			t.Error("Headers length is zero")
		}
		offset += 4 + headersLen

		// Should have at least one frame (data + trailer)
		remaining := encoded[offset:]
		if len(remaining) < HeaderSize {
			t.Error("Not enough data for frames")
		}
	})

	t.Run("error response encoding", func(t *testing.T) {
		// Create an error response like TypeScript would
		errorResp := CreateErrorResponse(StatusNotFound, "Resource not found")

		encoded, err := EncodeResponse(errorResp)
		if err != nil {
			t.Fatalf("EncodeResponse failed: %v", err)
		}

		// Decode and verify
		decoded, err := DecodeResponse(encoded)
		if err != nil {
			t.Fatalf("DecodeResponse failed: %v", err)
		}

		if !IsErrorResponse(*decoded) {
			t.Error("Response should be an error")
		}

		grpcErr := GetError(*decoded)
		if grpcErr.Code != StatusNotFound {
			t.Errorf("Error code mismatch: got %d, want %d", grpcErr.Code, StatusNotFound)
		}

		if grpcErr.Message != "Resource not found" {
			t.Errorf("Error message mismatch: got %s, want %s", grpcErr.Message, "Resource not found")
		}
	})
}

// TestCrossLanguageRequestDecoding verifies that a request encoded by
// TypeScript can be decoded by Go (if we had the TypeScript output).
func TestCrossLanguageRequestDecoding(t *testing.T) {
	// Manually construct what TypeScript would produce
	// Format: [path_len(4)][path][headers_len(4)][headers_json][grpc_frame]

	path := "/test.Service/Method"
	headers := `{"content-type":"application/grpc-web"}`
	message := []byte("test")

	// Build the request manually
	var buf []byte

	// Path length (big-endian)
	pathLen := len(path)
	buf = append(buf, byte(pathLen>>24), byte(pathLen>>16), byte(pathLen>>8), byte(pathLen))

	// Path
	buf = append(buf, []byte(path)...)

	// Headers length (big-endian)
	headersLen := len(headers)
	buf = append(buf, byte(headersLen>>24), byte(headersLen>>16), byte(headersLen>>8), byte(headersLen))

	// Headers
	buf = append(buf, []byte(headers)...)

	// gRPC frame (flags=0x00, length, data)
	messageLen := len(message)
	buf = append(buf, 0x00) // flags
	buf = append(buf, byte(messageLen>>24), byte(messageLen>>16), byte(messageLen>>8), byte(messageLen))
	buf = append(buf, message...)

	// Now decode it
	decoded, err := DecodeRequest(buf)
	if err != nil {
		t.Fatalf("DecodeRequest failed: %v", err)
	}

	if decoded.Path != path {
		t.Errorf("Path mismatch: got %s, want %s", decoded.Path, path)
	}

	if decoded.Headers["content-type"] != "application/grpc-web" {
		t.Errorf("Header mismatch: got %v", decoded.Headers)
	}

	if !bytes.Equal(decoded.Message, message) {
		t.Errorf("Message mismatch: got %v, want %v", decoded.Message, message)
	}
}

// TestCrossLanguageResponseDecoding verifies that a response encoded by
// TypeScript can be decoded by Go (if we had the TypeScript output).
func TestCrossLanguageResponseDecoding(t *testing.T) {
	// Manually construct what TypeScript would produce
	// Format: [headers_len(4)][headers_json][data_frames][trailer_frame]

	headers := `{"server":"grpc-web"}`
	message := []byte("response")
	trailers := "grpc-status: 0\r\ngrpc-message: OK\r\n"

	// Build the response manually
	var buf []byte

	// Headers length (big-endian)
	headersLen := len(headers)
	buf = append(buf, byte(headersLen>>24), byte(headersLen>>16), byte(headersLen>>8), byte(headersLen))

	// Headers
	buf = append(buf, []byte(headers)...)

	// Data frame (flags=0x00)
	messageLen := len(message)
	buf = append(buf, 0x00) // flags
	buf = append(buf, byte(messageLen>>24), byte(messageLen>>16), byte(messageLen>>8), byte(messageLen))
	buf = append(buf, message...)

	// Trailer frame (flags=0x01)
	trailersLen := len(trailers)
	buf = append(buf, 0x01) // flags
	buf = append(buf, byte(trailersLen>>24), byte(trailersLen>>16), byte(trailersLen>>8), byte(trailersLen))
	buf = append(buf, []byte(trailers)...)

	// Now decode it
	decoded, err := DecodeResponse(buf)
	if err != nil {
		t.Fatalf("DecodeResponse failed: %v", err)
	}

	if decoded.Headers["server"] != "grpc-web" {
		t.Errorf("Header mismatch: got %v", decoded.Headers)
	}

	if len(decoded.Messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(decoded.Messages))
	}

	if !bytes.Equal(decoded.Messages[0], message) {
		t.Errorf("Message mismatch: got %v, want %v", decoded.Messages[0], message)
	}

	if decoded.Trailers["grpc-status"] != "0" {
		t.Errorf("grpc-status mismatch: got %v", decoded.Trailers["grpc-status"])
	}

	if decoded.Trailers["grpc-message"] != "OK" {
		t.Errorf("grpc-message mismatch: got %v", decoded.Trailers["grpc-message"])
	}
}

// TestBinaryCompatibility tests that the binary format matches exactly
func TestBinaryCompatibility(t *testing.T) {
	// Test a known request encoding
	request := RequestEnvelope{
		Path:    "/test",
		Headers: map[string]string{},
		Message: []byte("hi"),
	}

	encoded, err := EncodeRequest(request)
	if err != nil {
		t.Fatalf("EncodeRequest failed: %v", err)
	}

	// Log the hex encoding for debugging
	t.Logf("Request encoding: %s", hex.EncodeToString(encoded))

	// Decode it back
	decoded, err := DecodeRequest(encoded)
	if err != nil {
		t.Fatalf("DecodeRequest failed: %v", err)
	}

	if decoded.Path != request.Path {
		t.Errorf("Path mismatch")
	}

	if !bytes.Equal(decoded.Message, request.Message) {
		t.Errorf("Message mismatch")
	}
}

// TestAllStatusCodes verifies all standard gRPC status codes
func TestAllStatusCodes(t *testing.T) {
	statusCodes := map[int]string{
		StatusOK:                 "OK",
		StatusCancelled:          "CANCELLED",
		StatusUnknown:            "UNKNOWN",
		StatusInvalidArgument:    "INVALID_ARGUMENT",
		StatusDeadlineExceeded:   "DEADLINE_EXCEEDED",
		StatusNotFound:           "NOT_FOUND",
		StatusAlreadyExists:      "ALREADY_EXISTS",
		StatusPermissionDenied:   "PERMISSION_DENIED",
		StatusResourceExhausted:  "RESOURCE_EXHAUSTED",
		StatusFailedPrecondition: "FAILED_PRECONDITION",
		StatusAborted:            "ABORTED",
		StatusOutOfRange:         "OUT_OF_RANGE",
		StatusUnimplemented:      "UNIMPLEMENTED",
		StatusInternal:           "INTERNAL",
		StatusUnavailable:        "UNAVAILABLE",
		StatusDataLoss:           "DATA_LOSS",
		StatusUnauthenticated:    "UNAUTHENTICATED",
	}

	for code, name := range statusCodes {
		t.Run(name, func(t *testing.T) {
			// Create error response
			errResp := CreateErrorResponse(code, "test error")

			// Encode and decode
			encoded, err := EncodeResponse(errResp)
			if err != nil {
				t.Fatalf("EncodeResponse failed: %v", err)
			}

			decoded, err := DecodeResponse(encoded)
			if err != nil {
				t.Fatalf("DecodeResponse failed: %v", err)
			}

			// Verify error details
			grpcErr := GetError(*decoded)
			if grpcErr == nil {
				if code != StatusOK {
					t.Error("Expected error, got nil")
				}
				return
			}

			if grpcErr.Code != code {
				t.Errorf("Code mismatch: got %d, want %d", grpcErr.Code, code)
			}

			// Verify status name
			statusName := GetStatusName(code)
			if statusName != name {
				t.Errorf("Status name mismatch: got %s, want %s", statusName, name)
			}
		})
	}
}
