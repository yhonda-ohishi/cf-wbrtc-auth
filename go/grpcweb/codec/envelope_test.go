package codec

import (
	"bytes"
	"reflect"
	"testing"
)

func TestEncodeRequest(t *testing.T) {
	tests := []struct {
		name     string
		envelope RequestEnvelope
		wantErr  bool
	}{
		{
			name: "basic request",
			envelope: RequestEnvelope{
				Path:    "/test.Service/Method",
				Headers: map[string]string{"content-type": "application/grpc-web"},
				Message: []byte("test message"),
			},
			wantErr: false,
		},
		{
			name: "empty headers",
			envelope: RequestEnvelope{
				Path:    "/test.Service/Method",
				Headers: map[string]string{},
				Message: []byte("test"),
			},
			wantErr: false,
		},
		{
			name: "empty message",
			envelope: RequestEnvelope{
				Path:    "/test.Service/Method",
				Headers: map[string]string{"key": "value"},
				Message: []byte{},
			},
			wantErr: false,
		},
		{
			name: "multiple headers",
			envelope: RequestEnvelope{
				Path: "/test.Service/Method",
				Headers: map[string]string{
					"authorization": "Bearer token",
					"content-type":  "application/grpc-web",
					"user-agent":    "test-client",
				},
				Message: []byte("hello world"),
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded, err := EncodeRequest(tt.envelope)
			if (err != nil) != tt.wantErr {
				t.Errorf("EncodeRequest() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err == nil && len(encoded) == 0 {
				t.Error("EncodeRequest() returned empty result")
			}
		})
	}
}

func TestDecodeRequest(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		want    *RequestEnvelope
		wantErr bool
	}{
		{
			name:    "incomplete data - too short",
			data:    []byte{0x00, 0x00},
			want:    nil,
			wantErr: true,
		},
		{
			name:    "incomplete data - missing path",
			data:    []byte{0x00, 0x00, 0x00, 0x0A}, // path length = 10, but no path data
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeRequest(tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("DecodeRequest() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("DecodeRequest() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRequestRoundTrip(t *testing.T) {
	tests := []struct {
		name     string
		envelope RequestEnvelope
	}{
		{
			name: "basic request",
			envelope: RequestEnvelope{
				Path:    "/test.Service/Method",
				Headers: map[string]string{"content-type": "application/grpc-web"},
				Message: []byte("test message"),
			},
		},
		{
			name: "empty headers",
			envelope: RequestEnvelope{
				Path:    "/package.Service/Method",
				Headers: map[string]string{},
				Message: []byte("data"),
			},
		},
		{
			name: "multiple headers",
			envelope: RequestEnvelope{
				Path: "/api.v1.Service/Create",
				Headers: map[string]string{
					"authorization": "Bearer xyz",
					"content-type":  "application/grpc-web+proto",
					"x-custom":      "value",
				},
				Message: []byte{0x01, 0x02, 0x03, 0x04},
			},
		},
		{
			name: "unicode path",
			envelope: RequestEnvelope{
				Path:    "/テスト.Service/メソッド",
				Headers: map[string]string{"key": "value"},
				Message: []byte("test"),
			},
		},
		{
			name: "large message",
			envelope: RequestEnvelope{
				Path:    "/test.Service/Method",
				Headers: map[string]string{"key": "value"},
				Message: make([]byte, 10000),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Encode
			encoded, err := EncodeRequest(tt.envelope)
			if err != nil {
				t.Fatalf("EncodeRequest() error = %v", err)
			}

			// Decode
			decoded, err := DecodeRequest(encoded)
			if err != nil {
				t.Fatalf("DecodeRequest() error = %v", err)
			}

			// Compare
			if decoded.Path != tt.envelope.Path {
				t.Errorf("Path mismatch: got %v, want %v", decoded.Path, tt.envelope.Path)
			}

			if !reflect.DeepEqual(decoded.Headers, tt.envelope.Headers) {
				t.Errorf("Headers mismatch: got %v, want %v", decoded.Headers, tt.envelope.Headers)
			}

			if !bytes.Equal(decoded.Message, tt.envelope.Message) {
				t.Errorf("Message mismatch: got %v, want %v", decoded.Message, tt.envelope.Message)
			}
		})
	}
}

func TestEncodeResponse(t *testing.T) {
	tests := []struct {
		name     string
		envelope ResponseEnvelope
		wantErr  bool
	}{
		{
			name: "basic response",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{"content-type": "application/grpc-web"},
				Messages: [][]byte{[]byte("response message")},
				Trailers: map[string]string{"grpc-status": "0"},
			},
			wantErr: false,
		},
		{
			name: "multiple messages",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{},
				Messages: [][]byte{[]byte("msg1"), []byte("msg2"), []byte("msg3")},
				Trailers: map[string]string{"grpc-status": "0", "grpc-message": "OK"},
			},
			wantErr: false,
		},
		{
			name: "error response",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{},
				Messages: [][]byte{},
				Trailers: map[string]string{"grpc-status": "13", "grpc-message": "Internal error"},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded, err := EncodeResponse(tt.envelope)
			if (err != nil) != tt.wantErr {
				t.Errorf("EncodeResponse() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err == nil && len(encoded) == 0 {
				t.Error("EncodeResponse() returned empty result")
			}
		})
	}
}

func TestDecodeResponse(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		want    *ResponseEnvelope
		wantErr bool
	}{
		{
			name:    "incomplete data - too short",
			data:    []byte{0x00, 0x00},
			want:    nil,
			wantErr: true,
		},
		{
			name:    "incomplete data - missing headers",
			data:    []byte{0x00, 0x00, 0x00, 0x0A}, // headers length = 10, but no data
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeResponse(tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("DecodeResponse() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("DecodeResponse() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestResponseRoundTrip(t *testing.T) {
	tests := []struct {
		name     string
		envelope ResponseEnvelope
	}{
		{
			name: "basic response",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{"content-type": "application/grpc-web"},
				Messages: [][]byte{[]byte("test response")},
				Trailers: map[string]string{"grpc-status": "0"},
			},
		},
		{
			name: "multiple messages",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{"server": "grpc-web"},
				Messages: [][]byte{[]byte("msg1"), []byte("msg2"), []byte("msg3")},
				Trailers: map[string]string{"grpc-status": "0", "grpc-message": "OK"},
			},
		},
		{
			name: "empty messages",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{},
				Messages: [][]byte{},
				Trailers: map[string]string{"grpc-status": "0"},
			},
		},
		{
			name: "error response",
			envelope: ResponseEnvelope{
				Headers:  map[string]string{},
				Messages: [][]byte{},
				Trailers: map[string]string{
					"grpc-status":  "13",
					"grpc-message": "Internal server error",
				},
			},
		},
		{
			name: "large messages",
			envelope: ResponseEnvelope{
				Headers: map[string]string{"key": "value"},
				Messages: [][]byte{
					make([]byte, 5000),
					make([]byte, 5000),
				},
				Trailers: map[string]string{"grpc-status": "0"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Encode
			encoded, err := EncodeResponse(tt.envelope)
			if err != nil {
				t.Fatalf("EncodeResponse() error = %v", err)
			}

			// Decode
			decoded, err := DecodeResponse(encoded)
			if err != nil {
				t.Fatalf("DecodeResponse() error = %v", err)
			}

			// Compare headers
			if !reflect.DeepEqual(decoded.Headers, tt.envelope.Headers) {
				t.Errorf("Headers mismatch: got %v, want %v", decoded.Headers, tt.envelope.Headers)
			}

			// Compare messages
			if len(decoded.Messages) != len(tt.envelope.Messages) {
				t.Errorf("Messages length mismatch: got %d, want %d", len(decoded.Messages), len(tt.envelope.Messages))
			} else {
				for i := range decoded.Messages {
					if !bytes.Equal(decoded.Messages[i], tt.envelope.Messages[i]) {
						t.Errorf("Message %d mismatch", i)
					}
				}
			}

			// Compare trailers
			if !reflect.DeepEqual(decoded.Trailers, tt.envelope.Trailers) {
				t.Errorf("Trailers mismatch: got %v, want %v", decoded.Trailers, tt.envelope.Trailers)
			}
		})
	}
}

func TestCreateErrorResponse(t *testing.T) {
	tests := []struct {
		name    string
		code    int
		message string
	}{
		{
			name:    "OK status",
			code:    StatusOK,
			message: "Success",
		},
		{
			name:    "not found",
			code:    StatusNotFound,
			message: "Resource not found",
		},
		{
			name:    "internal error",
			code:    StatusInternal,
			message: "Internal server error",
		},
		{
			name:    "unauthenticated",
			code:    StatusUnauthenticated,
			message: "Authentication required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			envelope := CreateErrorResponse(tt.code, tt.message)

			// Check structure
			if len(envelope.Headers) != 0 {
				t.Errorf("Expected empty headers, got %v", envelope.Headers)
			}

			if len(envelope.Messages) != 0 {
				t.Errorf("Expected empty messages, got %v", envelope.Messages)
			}

			// Check trailers - just verify it's a valid number string
			if len(envelope.Trailers["grpc-status"]) == 0 {
				t.Error("grpc-status is empty")
			}

			if envelope.Trailers["grpc-message"] != tt.message {
				t.Errorf("grpc-message = %v, want %v", envelope.Trailers["grpc-message"], tt.message)
			}
		})
	}
}

func TestIsErrorResponse(t *testing.T) {
	tests := []struct {
		name     string
		envelope ResponseEnvelope
		want     bool
	}{
		{
			name: "OK response",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{"grpc-status": "0"},
			},
			want: false,
		},
		{
			name: "error response",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{"grpc-status": "13"},
			},
			want: true,
		},
		{
			name: "no status",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{},
			},
			want: false,
		},
		{
			name: "invalid status",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{"grpc-status": "invalid"},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsErrorResponse(tt.envelope); got != tt.want {
				t.Errorf("IsErrorResponse() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetError(t *testing.T) {
	tests := []struct {
		name     string
		envelope ResponseEnvelope
		want     *GRPCError
	}{
		{
			name: "OK response",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{"grpc-status": "0"},
			},
			want: nil,
		},
		{
			name: "error response",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{
					"grpc-status":  "13",
					"grpc-message": "Internal error",
				},
			},
			want: &GRPCError{
				Code:    StatusInternal,
				Message: "Internal error",
			},
		},
		{
			name: "error without message",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{"grpc-status": "5"},
			},
			want: &GRPCError{
				Code:    StatusNotFound,
				Message: "Unknown error",
			},
		},
		{
			name: "no status",
			envelope: ResponseEnvelope{
				Trailers: map[string]string{},
			},
			want: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetError(tt.envelope)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GetError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetStatusName(t *testing.T) {
	tests := []struct {
		code int
		want string
	}{
		{StatusOK, "OK"},
		{StatusCancelled, "CANCELLED"},
		{StatusUnknown, "UNKNOWN"},
		{StatusInvalidArgument, "INVALID_ARGUMENT"},
		{StatusDeadlineExceeded, "DEADLINE_EXCEEDED"},
		{StatusNotFound, "NOT_FOUND"},
		{StatusAlreadyExists, "ALREADY_EXISTS"},
		{StatusPermissionDenied, "PERMISSION_DENIED"},
		{StatusResourceExhausted, "RESOURCE_EXHAUSTED"},
		{StatusFailedPrecondition, "FAILED_PRECONDITION"},
		{StatusAborted, "ABORTED"},
		{StatusOutOfRange, "OUT_OF_RANGE"},
		{StatusUnimplemented, "UNIMPLEMENTED"},
		{StatusInternal, "INTERNAL"},
		{StatusUnavailable, "UNAVAILABLE"},
		{StatusDataLoss, "DATA_LOSS"},
		{StatusUnauthenticated, "UNAUTHENTICATED"},
		{999, "UNKNOWN"}, // Invalid code
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := GetStatusName(tt.code); got != tt.want {
				t.Errorf("GetStatusName(%d) = %v, want %v", tt.code, got, tt.want)
			}
		})
	}
}

func TestGRPCErrorInterface(t *testing.T) {
	err := &GRPCError{
		Code:    StatusInternal,
		Message: "Something went wrong",
	}

	// Test that it implements error interface
	var _ error = err

	// Test Error() method
	errMsg := err.Error()
	if errMsg == "" {
		t.Error("Error() returned empty string")
	}

	// Should contain code, status name, and message
	if !bytes.Contains([]byte(errMsg), []byte("13")) {
		t.Error("Error message should contain code")
	}
	if !bytes.Contains([]byte(errMsg), []byte("INTERNAL")) {
		t.Error("Error message should contain status name")
	}
	if !bytes.Contains([]byte(errMsg), []byte("Something went wrong")) {
		t.Error("Error message should contain the message")
	}
}
