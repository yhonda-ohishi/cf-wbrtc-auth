# gRPC-Web Codec Package

This package implements gRPC-Web encoding and decoding for Go, compatible with the TypeScript implementation in `src/grpc/codec/`.

## Components

### Frame Codec (`frame.go`)

Low-level gRPC-Web frame encoding/decoding.

### Envelope Codec (`envelope.go`)

Higher-level message envelope encoding/decoding for complete gRPC-Web requests and responses.

## Frame Format

Each gRPC-Web frame consists of:
- **1 byte**: Flags (0x00 = data frame, 0x01 = trailer frame)
- **4 bytes**: Message length (big-endian uint32)
- **N bytes**: Message payload

## Usage

### Encoding a Data Frame

```go
import "github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"

// Create a data frame
frame := codec.CreateDataFrame([]byte("Hello, gRPC-Web!"))

// Encode it
encoded := codec.EncodeFrame(frame)
```

### Decoding Frames

The decoder handles partial frames and multiple frames in a single buffer:

```go
// Decode frames from buffer
result := codec.DecodeFrames(buffer)

// Process decoded frames
for _, frame := range result.Frames {
    if frame.Flags == codec.FrameData {
        // Handle data frame
        processData(frame.Data)
    } else if frame.Flags == codec.FrameTrailer {
        // Handle trailer frame
        trailers := codec.ParseTrailers(frame.Data)
        processTrailers(trailers)
    }
}

// Keep remaining bytes for next iteration
buffer = result.Remaining
```

### Stream Processing Example

```go
var buffer []byte

// As data arrives over the network
for chunk := range networkStream {
    // Append new data to buffer
    buffer = append(buffer, chunk...)

    // Decode available frames
    result := codec.DecodeFrames(buffer)

    // Process frames
    for _, frame := range result.Frames {
        handleFrame(frame)
    }

    // Keep remaining bytes for next iteration
    buffer = result.Remaining
}
```

### Creating Trailer Frames

Trailers are encoded in HTTP/1.1 header format:

```go
trailers := map[string]string{
    "grpc-status":  "0",
    "grpc-message": "OK",
}

frame := codec.CreateTrailerFrame(trailers)
encoded := codec.EncodeFrame(frame)
```

### Parsing Trailers

```go
trailers := codec.ParseTrailers(frame.Data)
status := trailers["grpc-status"]
message := trailers["grpc-message"]
```

## Constants

- `FrameData` (0x00): Data frame flag
- `FrameTrailer` (0x01): Trailer frame flag
- `HeaderSize` (5): Size of frame header in bytes

## Functions

### EncodeFrame

```go
func EncodeFrame(frame Frame) []byte
```

Encodes a single frame into gRPC-Web format.

### DecodeFrames

```go
func DecodeFrames(buffer []byte) DecodeResult
```

Decodes frames from buffer. Returns decoded frames and any remaining bytes that don't form a complete frame.

### CreateDataFrame

```go
func CreateDataFrame(data []byte) Frame
```

Creates a data frame with the given payload.

### CreateTrailerFrame

```go
func CreateTrailerFrame(trailers map[string]string) Frame
```

Creates a trailer frame from headers. Trailers are encoded as HTTP/1.1 headers format.

### ParseTrailers

```go
func ParseTrailers(data []byte) map[string]string
```

Parses trailer frame data to headers. Keys are normalized to lowercase.

## Testing

Run tests with:

```bash
go test ./codec/...
```

Run with coverage:

```bash
go test ./codec/... -cover
```

## Envelope Codec

### Request Envelope

Format sent from client to server over DataChannel:
```
[4 bytes path_len][path UTF-8][4 bytes headers_len][headers JSON][gRPC frames]
```

Example:
```go
request := codec.RequestEnvelope{
    Path: "/myservice.MyService/MyMethod",
    Headers: map[string]string{
        "content-type": "application/grpc-web+proto",
        "authorization": "Bearer token",
    },
    Message: []byte("serialized protobuf message"),
}

encoded, err := codec.EncodeRequest(request)
// Send encoded over DataChannel...
```

### Response Envelope

Format received from server over DataChannel:
```
[4 bytes headers_len][headers JSON][data frames...][trailer frame]
```

Example:
```go
// Received data from DataChannel...
decoded, err := codec.DecodeResponse(data)
if err != nil {
    log.Fatal(err)
}

// Check for errors
if codec.IsErrorResponse(*decoded) {
    grpcErr := codec.GetError(*decoded)
    log.Printf("gRPC error: %s", grpcErr.Error())
    return
}

// Process messages
for _, msg := range decoded.Messages {
    // Deserialize protobuf...
}
```

### Error Handling

```go
// Create error response
errorResp := codec.CreateErrorResponse(
    codec.StatusNotFound,
    "Resource not found",
)

// Check if response is an error
if codec.IsErrorResponse(response) {
    err := codec.GetError(response)
    fmt.Printf("Error: %s\n", err.Error())
}
```

### gRPC Status Codes

Standard gRPC status codes are defined as constants:

- `StatusOK` (0): Success
- `StatusCancelled` (1): Operation cancelled
- `StatusUnknown` (2): Unknown error
- `StatusInvalidArgument` (3): Invalid argument
- `StatusDeadlineExceeded` (4): Deadline exceeded
- `StatusNotFound` (5): Resource not found
- `StatusAlreadyExists` (6): Resource already exists
- `StatusPermissionDenied` (7): Permission denied
- `StatusResourceExhausted` (8): Resource exhausted
- `StatusFailedPrecondition` (9): Precondition failed
- `StatusAborted` (10): Operation aborted
- `StatusOutOfRange` (11): Out of range
- `StatusUnimplemented` (12): Not implemented
- `StatusInternal` (13): Internal error
- `StatusUnavailable` (14): Service unavailable
- `StatusDataLoss` (15): Data loss
- `StatusUnauthenticated` (16): Authentication required

Use `GetStatusName(code)` to get the human-readable name.

## Implementation Notes

- Big-endian encoding is used for all length fields (network byte order)
- Decoder handles partial frames gracefully
- Decoder can process multiple frames in a single buffer
- Frame data is copied to avoid referencing original buffer
- Trailer keys are normalized to lowercase for consistent lookups
- Map iteration order in Go is non-deterministic, so trailer encoding order may vary
- Fully compatible with TypeScript implementation in `src/grpc/codec/`

## Compatibility

This implementation is fully compatible with the TypeScript version. Both use:

- **Big-endian** byte order for all length fields
- **JSON encoding** for headers and trailers
- **UTF-8 encoding** for strings
- **gRPC-Web frame format** for message wrapping

The codec has been tested for cross-language compatibility with test vectors matching the TypeScript implementation.
