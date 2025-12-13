package codec

import (
	"bytes"
	"reflect"
	"testing"
)

func TestEncodeFrame(t *testing.T) {
	tests := []struct {
		name     string
		frame    Frame
		expected []byte
	}{
		{
			name: "data frame with content",
			frame: Frame{
				Flags: FrameData,
				Data:  []byte("hello"),
			},
			expected: []byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e', 'l', 'l', 'o'},
		},
		{
			name: "trailer frame",
			frame: Frame{
				Flags: FrameTrailer,
				Data:  []byte("grpc-status: 0\r\n"),
			},
			expected: append([]byte{0x01, 0x00, 0x00, 0x00, 0x10}, []byte("grpc-status: 0\r\n")...),
		},
		{
			name: "empty data frame",
			frame: Frame{
				Flags: FrameData,
				Data:  []byte{},
			},
			expected: []byte{0x00, 0x00, 0x00, 0x00, 0x00},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := EncodeFrame(tt.frame)
			if !bytes.Equal(result, tt.expected) {
				t.Errorf("EncodeFrame() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestDecodeFrames(t *testing.T) {
	tests := []struct {
		name              string
		buffer            []byte
		expectedFrames    []Frame
		expectedRemaining []byte
	}{
		{
			name:   "single complete frame",
			buffer: []byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e', 'l', 'l', 'o'},
			expectedFrames: []Frame{
				{Flags: FrameData, Data: []byte("hello")},
			},
			expectedRemaining: []byte{},
		},
		{
			name: "multiple complete frames",
			buffer: append(
				[]byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e', 'l', 'l', 'o'},
				[]byte{0x01, 0x00, 0x00, 0x00, 0x05, 'w', 'o', 'r', 'l', 'd'}...,
			),
			expectedFrames: []Frame{
				{Flags: FrameData, Data: []byte("hello")},
				{Flags: FrameTrailer, Data: []byte("world")},
			},
			expectedRemaining: []byte{},
		},
		{
			name:              "incomplete header",
			buffer:            []byte{0x00, 0x00, 0x00},
			expectedFrames:    []Frame{},
			expectedRemaining: []byte{0x00, 0x00, 0x00},
		},
		{
			name:              "incomplete message",
			buffer:            []byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e'},
			expectedFrames:    []Frame{},
			expectedRemaining: []byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e'},
		},
		{
			name: "complete frame with partial next frame",
			buffer: append(
				[]byte{0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e', 'l', 'l', 'o'},
				[]byte{0x01, 0x00, 0x00}...,
			),
			expectedFrames: []Frame{
				{Flags: FrameData, Data: []byte("hello")},
			},
			expectedRemaining: []byte{0x01, 0x00, 0x00},
		},
		{
			name:              "empty buffer",
			buffer:            []byte{},
			expectedFrames:    []Frame{},
			expectedRemaining: []byte{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := DecodeFrames(tt.buffer)

			if len(result.Frames) != len(tt.expectedFrames) {
				t.Errorf("DecodeFrames() got %d frames, want %d", len(result.Frames), len(tt.expectedFrames))
				return
			}

			for i, frame := range result.Frames {
				if frame.Flags != tt.expectedFrames[i].Flags {
					t.Errorf("Frame %d flags = %v, want %v", i, frame.Flags, tt.expectedFrames[i].Flags)
				}
				if !bytes.Equal(frame.Data, tt.expectedFrames[i].Data) {
					t.Errorf("Frame %d data = %v, want %v", i, frame.Data, tt.expectedFrames[i].Data)
				}
			}

			if !bytes.Equal(result.Remaining, tt.expectedRemaining) {
				t.Errorf("DecodeFrames() remaining = %v, want %v", result.Remaining, tt.expectedRemaining)
			}
		})
	}
}

func TestCreateDataFrame(t *testing.T) {
	data := []byte("test data")
	frame := CreateDataFrame(data)

	if frame.Flags != FrameData {
		t.Errorf("CreateDataFrame() flags = %v, want %v", frame.Flags, FrameData)
	}

	if !bytes.Equal(frame.Data, data) {
		t.Errorf("CreateDataFrame() data = %v, want %v", frame.Data, data)
	}
}

func TestCreateTrailerFrame(t *testing.T) {
	trailers := map[string]string{
		"grpc-status":  "0",
		"grpc-message": "OK",
	}

	frame := CreateTrailerFrame(trailers)

	if frame.Flags != FrameTrailer {
		t.Errorf("CreateTrailerFrame() flags = %v, want %v", frame.Flags, FrameTrailer)
	}

	// Parse the data back to verify
	parsed := ParseTrailers(frame.Data)

	for key, value := range trailers {
		if parsed[key] != value {
			t.Errorf("CreateTrailerFrame() missing or incorrect header %s: got %v, want %v", key, parsed[key], value)
		}
	}
}

func TestParseTrailers(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		expected map[string]string
	}{
		{
			name: "single header",
			data: []byte("grpc-status: 0\r\n"),
			expected: map[string]string{
				"grpc-status": "0",
			},
		},
		{
			name: "multiple headers",
			data: []byte("grpc-status: 0\r\ngrpc-message: OK\r\n"),
			expected: map[string]string{
				"grpc-status":  "0",
				"grpc-message": "OK",
			},
		},
		{
			name: "headers with whitespace",
			data: []byte("grpc-status : 0 \r\n grpc-message: OK\r\n"),
			expected: map[string]string{
				"grpc-status":  "0",
				"grpc-message": "OK",
			},
		},
		{
			name:     "empty headers",
			data:     []byte("\r\n"),
			expected: map[string]string{},
		},
		{
			name: "invalid header line ignored",
			data: []byte("grpc-status: 0\r\ninvalidline\r\ngrpc-message: OK\r\n"),
			expected: map[string]string{
				"grpc-status":  "0",
				"grpc-message": "OK",
			},
		},
		{
			name: "case insensitive keys",
			data: []byte("Grpc-Status: 0\r\nGRPC-MESSAGE: OK\r\n"),
			expected: map[string]string{
				"grpc-status":  "0",
				"grpc-message": "OK",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseTrailers(tt.data)

			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("ParseTrailers() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestRoundTrip(t *testing.T) {
	tests := []struct {
		name  string
		frame Frame
	}{
		{
			name: "data frame",
			frame: Frame{
				Flags: FrameData,
				Data:  []byte("test message"),
			},
		},
		{
			name: "trailer frame",
			frame: Frame{
				Flags: FrameTrailer,
				Data:  []byte("grpc-status: 0\r\ngrpc-message: success\r\n"),
			},
		},
		{
			name: "empty data",
			frame: Frame{
				Flags: FrameData,
				Data:  []byte{},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Encode
			encoded := EncodeFrame(tt.frame)

			// Decode
			result := DecodeFrames(encoded)

			// Should have exactly one frame
			if len(result.Frames) != 1 {
				t.Fatalf("Expected 1 frame, got %d", len(result.Frames))
			}

			// Should have no remaining bytes
			if len(result.Remaining) != 0 {
				t.Errorf("Expected no remaining bytes, got %d", len(result.Remaining))
			}

			// Frame should match original
			decoded := result.Frames[0]
			if decoded.Flags != tt.frame.Flags {
				t.Errorf("Flags mismatch: got %v, want %v", decoded.Flags, tt.frame.Flags)
			}
			if !bytes.Equal(decoded.Data, tt.frame.Data) {
				t.Errorf("Data mismatch: got %v, want %v", decoded.Data, tt.frame.Data)
			}
		})
	}
}

func TestLargeMessage(t *testing.T) {
	// Test with a large message (> 64KB)
	largeData := make([]byte, 100000)
	for i := range largeData {
		largeData[i] = byte(i % 256)
	}

	frame := CreateDataFrame(largeData)
	encoded := EncodeFrame(frame)
	result := DecodeFrames(encoded)

	if len(result.Frames) != 1 {
		t.Fatalf("Expected 1 frame, got %d", len(result.Frames))
	}

	if !bytes.Equal(result.Frames[0].Data, largeData) {
		t.Error("Large message data mismatch")
	}
}
