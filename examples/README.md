# gRPC-Web over DataChannel Examples

This directory contains example code demonstrating how to use the gRPC-Web transport over WebRTC DataChannel.

## Structure

```
examples/
├── go/
│   └── server.go      # Go server-side examples
├── typescript/
│   └── client.ts      # TypeScript client-side examples
└── README.md          # This file
```

## Go Server Examples

The Go examples show how to:

1. **Basic Setup**: Create a transport and register handlers
2. **Type-Safe Handlers**: Use `MakeHandler` for typed request/response
3. **Server Reflection**: Enable service discovery
4. **Error Handling**: Return gRPC status codes
5. **Raw Handlers**: Full control over request/response

### Quick Start (Go)

```go
import "github.com/anthropics/cf-wbrtc-auth/go/grpcweb"

// Create transport from WebRTC DataChannel
transport := grpcweb.NewTransport(dataChannel, nil)

// Enable reflection
grpcweb.RegisterReflection(transport)

// Register a handler
handler := grpcweb.MakeHandler(
    deserializeFunc,
    serializeFunc,
    func(ctx context.Context, req *MyRequest) (*MyResponse, error) {
        return &MyResponse{Result: "OK"}, nil
    },
)
transport.RegisterHandler("/mypackage.MyService/MyMethod", handler)

// Start
transport.Start()
```

## TypeScript Client Examples

The TypeScript examples show how to:

1. **Basic Calls**: Make unary RPC calls
2. **Server Reflection**: Discover available services
3. **Error Handling**: Catch and handle `GrpcError`
4. **Custom Options**: Set timeouts and headers
5. **Concurrent Requests**: Make multiple requests in parallel

### Quick Start (TypeScript)

```typescript
import { DataChannelTransport, ReflectionClient, GrpcError } from './grpc';

// Create transport
const transport = new DataChannelTransport(dataChannel);

// Make a call
try {
  const response = await transport.unary(
    '/mypackage.MyService/MyMethod',
    { data: 'test' },
    serialize,
    deserialize
  );
  console.log(response.message);
} catch (error) {
  if (error instanceof GrpcError) {
    console.log(`gRPC Error ${error.code}: ${error.message}`);
  }
}

// Use reflection
const reflection = new ReflectionClient(transport);
const services = await reflection.listServices();
```

## Message Serialization

These examples use JSON for simplicity. In production, you would typically use Protocol Buffers:

```typescript
// With protobuf-ts or similar
import { MyRequest, MyResponse } from './generated/my_service';

const response = await transport.unary(
  '/mypackage.MyService/MyMethod',
  request,
  (msg) => MyRequest.toBinary(msg),
  (data) => MyResponse.fromBinary(data)
);
```

## Notes

- These are demonstration files showing API usage patterns
- The Go examples require a WebRTC connection to run
- For full integration, see the main project documentation
