# gRPC-Web DataChannel Transport

This package implements a server-side gRPC-Web transport over WebRTC DataChannel. It allows Go applications to receive and handle gRPC-Web requests from browser clients over a WebRTC peer-to-peer connection.

## Overview

The DataChannel transport acts as the server side of the gRPC-Web protocol:

1. Receives `RequestEnvelope` messages from browser clients
2. Routes requests to registered handlers based on method path
3. Executes handlers with configurable timeouts
4. Sends back `ResponseEnvelope` messages
5. Automatically handles error responses and request IDs

## Usage

### Basic Setup

```go
import (
    "github.com/anthropics/cf-wbrtc-auth/go/grpcweb/transport"
    "github.com/pion/webrtc/v4"
)

// Create transport from a WebRTC DataChannel
dc := // ... get from peer connection
transport := transport.NewDataChannelTransport(dc, nil)

// Register a handler
transport.RegisterHandler("/print.PrintService/Print", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
    // Process request
    return &codec.ResponseEnvelope{
        Headers:  map[string]string{},
        Messages: [][]byte{responseData},
        Trailers: map[string]string{"grpc-status": "0"},
    }, nil
})

// Start listening
transport.Start()
defer transport.Close()
```

### Typed Handlers with MakeHandler

For better type safety, use `MakeHandler` to work with typed requests and responses:

```go
handler := transport.MakeHandler(
    // Deserializer: []byte -> *Request
    func(data []byte) (*PrintRequest, error) {
        req := &PrintRequest{}
        err := proto.Unmarshal(data, req)
        return req, err
    },
    // Serializer: *Response -> []byte
    func(resp *PrintResponse) ([]byte, error) {
        return proto.Marshal(resp)
    },
    // Handler: *Request -> *Response
    func(ctx context.Context, req *PrintRequest) (*PrintResponse, error) {
        // Your business logic here
        return &PrintResponse{...}, nil
    },
)

transport.RegisterHandler("/print.PrintService/Print", handler)
```

### Custom Timeouts

Configure request timeouts:

```go
opts := &transport.HandlerOptions{
    Timeout: 60 * time.Second,
}
transport := transport.NewDataChannelTransport(dc, opts)
```

Handlers receive a context with the configured deadline.

### Error Handling

Return gRPC errors from handlers:

```go
transport.RegisterHandler("/service/Method", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
    if invalid {
        return nil, &codec.GRPCError{
            Code:    codec.StatusInvalidArgument,
            Message: "Invalid input",
        }
    }
    // ...
})
```

If a handler returns an error, it's automatically converted to a gRPC error response:
- `*codec.GRPCError` errors preserve the code and message
- Other errors are wrapped as `StatusInternal`

### Request Tracing

The `x-request-id` header is automatically echoed from request to response:

```go
transport.RegisterHandler("/service/Method", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
    // Access request ID for logging
    if reqID, ok := req.Headers["x-request-id"]; ok {
        log.Printf("Processing request: %s", reqID)
    }
    // Request ID will be automatically added to response headers
    return response, nil
})
```

### Close Callbacks

Register cleanup callbacks:

```go
transport.OnClose(func() {
    log.Println("Transport closed")
    // Clean up resources
})
```

## Architecture

### Message Flow

```
Browser Client                    Go Server
      |                                |
      |  RequestEnvelope              |
      |------------------------------>|
      |                               |
      |                        Decode Request
      |                        Route to Handler
      |                        Execute Handler
      |                        Encode Response
      |                               |
      |  ResponseEnvelope             |
      |<------------------------------|
      |                               |
```

### Request Envelope Format

```
[path_len(4)][path(N)][headers_len(4)][headers_json(M)][grpc_frames]
```

- **path**: Method path like "/package.Service/Method"
- **headers**: JSON-encoded metadata map
- **grpc_frames**: gRPC-Web framed data (see codec package)

### Response Envelope Format

```
[headers_len(4)][headers_json(N)][data_frames...][trailer_frame]
```

- **headers**: Response headers
- **data_frames**: One or more data frames with response messages
- **trailer_frame**: Contains grpc-status, grpc-message, etc.

## Error Codes

Common gRPC status codes:

- `StatusOK` (0): Success
- `StatusInvalidArgument` (3): Invalid request
- `StatusNotFound` (5): Resource not found
- `StatusPermissionDenied` (7): Access denied
- `StatusUnimplemented` (12): Method not implemented
- `StatusInternal` (13): Internal error
- `StatusDeadlineExceeded` (4): Request timeout

See `codec.Status*` constants for the full list.

## Best Practices

1. **Register all handlers before calling Start()**
   ```go
   transport := NewDataChannelTransport(dc, nil)
   transport.RegisterHandler("/service/Method1", handler1)
   transport.RegisterHandler("/service/Method2", handler2)
   transport.Start() // Start after registration
   ```

2. **Use MakeHandler for type safety**
   - Avoids manual encoding/decoding errors
   - Provides compile-time type checking
   - Makes code more maintainable

3. **Handle context cancellation**
   ```go
   func handler(ctx context.Context, req *Request) (*Response, error) {
       select {
       case <-ctx.Done():
           return nil, &codec.GRPCError{
               Code:    codec.StatusDeadlineExceeded,
               Message: "Request cancelled",
           }
       case result := <-processRequest(req):
           return result, nil
       }
   }
   ```

4. **Always defer Close()**
   ```go
   transport := NewDataChannelTransport(dc, nil)
   defer transport.Close()
   ```

5. **Use x-request-id for debugging**
   - Automatically echoed in responses
   - Use for correlating logs across client/server

## Integration with WebRTC

Typical integration pattern:

```go
// Create peer connection
pc, _ := webrtc.NewPeerConnection(config)

// Handle incoming data channel from browser
pc.OnDataChannel(func(dc *webrtc.DataChannel) {
    if dc.Label() == "grpc-web" {
        // Create transport
        transport := NewDataChannelTransport(dc, nil)

        // Register handlers
        transport.RegisterHandler("/print.PrintService/Print", printHandler)

        // Start
        transport.Start()

        // Clean up on close
        transport.OnClose(func() {
            log.Println("gRPC-Web channel closed")
        })
    }
})
```

## See Also

- `../codec` - Envelope encoding/decoding
- `../../client` - Example Go client implementation
- Browser client documentation (TypeScript/JavaScript)
