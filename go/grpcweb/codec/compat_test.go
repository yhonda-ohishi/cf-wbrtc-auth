package codec

import (
	"encoding/hex"
	"testing"
)

// TestTypeScriptCompatibility ensures Go implementation matches TypeScript output
func TestTypeScriptCompatibility(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected string // hex encoded expected output
	}{
		{
			name:  "data frame with 'hello'",
			input: []byte("hello"),
			// TypeScript: buffer[0] = 0x00, buffer[1-4] = length (5), buffer[5-9] = "hello"
			expected: "000000000568656c6c6f",
		},
		{
			name:     "empty data frame",
			input:    []byte{},
			expected: "0000000000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			frame := CreateDataFrame(tt.input)
			encoded := EncodeFrame(frame)
			encodedHex := hex.EncodeToString(encoded)

			if encodedHex != tt.expected {
				t.Errorf("EncodeFrame() = %s, want %s", encodedHex, tt.expected)
			}
		})
	}
}

// TestDecodeTypeScriptOutput ensures Go can decode TypeScript-encoded frames
func TestDecodeTypeScriptOutput(t *testing.T) {
	tests := []struct {
		name           string
		tsEncodedHex   string
		expectedFrames int
		expectedData   string
	}{
		{
			name:           "TypeScript encoded 'hello'",
			tsEncodedHex:   "000000000568656c6c6f",
			expectedFrames: 1,
			expectedData:   "hello",
		},
		{
			name:           "TypeScript encoded empty frame",
			tsEncodedHex:   "0000000000",
			expectedFrames: 1,
			expectedData:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded, err := hex.DecodeString(tt.tsEncodedHex)
			if err != nil {
				t.Fatalf("Failed to decode hex: %v", err)
			}

			result := DecodeFrames(encoded)

			if len(result.Frames) != tt.expectedFrames {
				t.Errorf("DecodeFrames() got %d frames, want %d", len(result.Frames), tt.expectedFrames)
				return
			}

			if tt.expectedFrames > 0 {
				actualData := string(result.Frames[0].Data)
				if actualData != tt.expectedData {
					t.Errorf("Frame data = %q, want %q", actualData, tt.expectedData)
				}
			}
		})
	}
}
