# Integration Guide: DataChannel Transport with WebRTC

This guide shows how to integrate the DataChannel transport into a real WebRTC application.

## Complete Example: Print Service over WebRTC

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
    "github.com/anthropics/cf-wbrtc-auth/go/grpcweb/transport"
    "github.com/pion/webrtc/v4"
)

// Example protobuf message types (normally generated from .proto files)
type PrintRequest struct {
    DocumentID string
    Pages      int32
}

type PrintResponse struct {
    JobID  string
    Status string
}

// Serialization helpers (normally from protobuf generated code)
func unmarshalPrintRequest(data []byte) (*PrintRequest, error) {
    // In real code: proto.Unmarshal(data, &PrintRequest{})
    return &PrintRequest{DocumentID: "example", Pages: 1}, nil
}

func marshalPrintResponse(resp *PrintResponse) ([]byte, error) {
    // In real code: proto.Marshal(resp)
    return []byte(fmt.Sprintf("%s:%s", resp.JobID, resp.Status)), nil
}

// Business logic handler
func handlePrint(ctx context.Context, req *PrintRequest) (*PrintResponse, error) {
    log.Printf("Print request: DocumentID=%s, Pages=%d", req.DocumentID, req.Pages)

    // Your print logic here
    jobID := fmt.Sprintf("job-%d", time.Now().Unix())

    return &PrintResponse{
        JobID:  jobID,
        Status: "queued",
    }, nil
}

func main() {
    // 1. Create WebRTC peer connection
    config := webrtc.Configuration{
        ICEServers: []webrtc.ICEServer{
            {URLs: []string{"stun:stun.l.google.com:19302"}},
        },
    }

    pc, err := webrtc.NewPeerConnection(config)
    if err != nil {
        log.Fatal(err)
    }
    defer pc.Close()

    // 2. Handle incoming data channels from browser
    pc.OnDataChannel(func(dc *webrtc.DataChannel) {
        log.Printf("Data channel opened: %s", dc.Label())

        // Only handle gRPC-Web channels
        if dc.Label() != "grpc-web" {
            return
        }

        // 3. Create transport
        opts := &transport.HandlerOptions{
            Timeout: 30 * time.Second,
        }
        grpcTransport := transport.NewDataChannelTransport(dc, opts)

        // 4. Register service handlers
        printHandler := transport.MakeHandler(
            unmarshalPrintRequest,
            marshalPrintResponse,
            handlePrint,
        )
        grpcTransport.RegisterHandler("/print.PrintService/Print", printHandler)

        // 5. Set up cleanup
        grpcTransport.OnClose(func() {
            log.Println("gRPC transport closed")
        })

        // 6. Start handling requests
        grpcTransport.Start()
        log.Println("gRPC transport ready")
    })

    // 7. WebRTC signaling setup (connect to browser)
    // ... implement your signaling here ...
    // This typically involves exchanging SDP offers/answers via WebSocket

    // Keep running
    select {}
}
```

## Integration with Existing Service

If you already have gRPC service definitions:

```go
// Assuming you have generated protobuf code:
import (
    pb "your/package/proto"
    "google.golang.org/protobuf/proto"
)

// Wrap your existing service implementation
type PrintService struct {
    // Your existing service fields
}

func (s *PrintService) Print(ctx context.Context, req *pb.PrintRequest) (*pb.PrintResponse, error) {
    // Your existing business logic
    return &pb.PrintResponse{
        JobID:  "job-123",
        Status: "queued",
    }, nil
}

// Register with transport
func setupTransport(dc *webrtc.DataChannel) {
    grpcTransport := transport.NewDataChannelTransport(dc, nil)

    svc := &PrintService{}

    // Create handler using protobuf marshaling
    printHandler := transport.MakeHandler(
        func(data []byte) (*pb.PrintRequest, error) {
            req := &pb.PrintRequest{}
            err := proto.Unmarshal(data, req)
            return req, err
        },
        func(resp *pb.PrintResponse) ([]byte, error) {
            return proto.Marshal(resp)
        },
        svc.Print, // Use your existing method
    )

    grpcTransport.RegisterHandler("/print.PrintService/Print", printHandler)
    grpcTransport.Start()
}
```

## Multiple Services

```go
func setupAllServices(dc *webrtc.DataChannel) *transport.DataChannelTransport {
    grpcTransport := transport.NewDataChannelTransport(dc, nil)

    // Print service
    grpcTransport.RegisterHandler("/print.PrintService/Print", printHandler)
    grpcTransport.RegisterHandler("/print.PrintService/GetStatus", statusHandler)

    // Scraping service
    grpcTransport.RegisterHandler("/scraping.ScrapingService/Scrape", scrapeHandler)

    // File service
    grpcTransport.RegisterHandler("/file.FileService/Upload", uploadHandler)

    grpcTransport.Start()
    return grpcTransport
}
```

## Error Handling Patterns

### Return gRPC errors for application errors

```go
func handlePrint(ctx context.Context, req *PrintRequest) (*PrintResponse, error) {
    if req.DocumentID == "" {
        return nil, &codec.GRPCError{
            Code:    codec.StatusInvalidArgument,
            Message: "document_id is required",
        }
    }

    // Check authorization
    if !isAuthorized(ctx, req.DocumentID) {
        return nil, &codec.GRPCError{
            Code:    codec.StatusPermissionDenied,
            Message: "access denied to document",
        }
    }

    // Process request...
    return &PrintResponse{...}, nil
}
```

### Handle context cancellation

```go
func handleLongRunningTask(ctx context.Context, req *Request) (*Response, error) {
    // Start background work
    resultCh := make(chan *Response)
    errCh := make(chan error)

    go func() {
        result, err := doWork(req)
        if err != nil {
            errCh <- err
        } else {
            resultCh <- result
        }
    }()

    // Wait for completion or cancellation
    select {
    case <-ctx.Done():
        return nil, &codec.GRPCError{
            Code:    codec.StatusDeadlineExceeded,
            Message: "request timeout",
        }
    case err := <-errCh:
        return nil, err
    case result := <-resultCh:
        return result, nil
    }
}
```

## Request Metadata

Access headers (metadata) from the request:

```go
func handlePrint(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
    // Access request metadata
    userID := req.Headers["x-user-id"]
    requestID := req.Headers["x-request-id"]

    log.Printf("Request %s from user %s", requestID, userID)

    // Process request...

    // Response headers are automatically set
    // (x-request-id is echoed automatically)
    return &codec.ResponseEnvelope{
        Headers: map[string]string{
            "x-server-version": "1.0.0",
        },
        Messages: [][]byte{responseData},
        Trailers: map[string]string{
            "grpc-status": "0",
        },
    }, nil
}
```

## Graceful Shutdown

```go
type Server struct {
    transports []*transport.DataChannelTransport
    mu         sync.Mutex
}

func (s *Server) addTransport(t *transport.DataChannelTransport) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.transports = append(s.transports, t)
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.mu.Lock()
    transports := s.transports
    s.mu.Unlock()

    for _, t := range transports {
        if err := t.Close(); err != nil {
            log.Printf("Error closing transport: %v", err)
        }
    }

    return nil
}
```

## Testing

Mock the transport for unit testing your handlers:

```go
func TestPrintHandler(t *testing.T) {
    handler := transport.MakeHandler(
        unmarshalPrintRequest,
        marshalPrintResponse,
        handlePrint,
    )

    req := &codec.RequestEnvelope{
        Path:    "/print.PrintService/Print",
        Headers: map[string]string{"x-user-id": "user123"},
        Message: marshalPrintRequest(&PrintRequest{
            DocumentID: "doc123",
            Pages:      5,
        }),
    }

    resp, err := handler(context.Background(), req)
    if err != nil {
        t.Fatalf("Handler error: %v", err)
    }

    // Verify response
    if len(resp.Messages) == 0 {
        t.Fatal("No response message")
    }

    // Unmarshal and check
    printResp, _ := unmarshalPrintResponse(resp.Messages[0])
    if printResp.Status != "queued" {
        t.Errorf("Expected status 'queued', got '%s'", printResp.Status)
    }
}
```

## Browser Client Example

See the browser-side implementation for how clients send requests:

```typescript
// Browser side (TypeScript)
const channel = peerConnection.createDataChannel('grpc-web');

const client = new GrpcWebClient(channel);

const response = await client.call('/print.PrintService/Print', {
    documentID: 'doc123',
    pages: 5
});

console.log('Print job:', response.jobID);
```

## See Also

- [Transport README](./README.md) - API documentation
- [Codec README](../codec/README.md) - Encoding details
- Browser client implementation (TypeScript)
