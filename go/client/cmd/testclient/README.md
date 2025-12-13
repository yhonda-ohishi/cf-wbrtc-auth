# Test Client

A test client for the Cloudflare Workers signaling server that demonstrates WebRTC P2P connections with gRPC-Web over DataChannel.

## Features

- Connects to the Cloudflare Workers signaling server via WebSocket
- Handles WebRTC offers from browsers
- Sets up DataChannel connections
- Exposes gRPC services over the DataChannel using gRPC-Web protocol
- Implements Server Reflection for service discovery

## Exposed Services

The test client exposes the following gRPC services:

### example.EchoService/Echo
Echoes back the message sent by the client.

**Request:**
```json
{
  "message": "Hello, World!"
}
```

**Response:**
```json
{
  "message": "Hello, World!"
}
```

### example.EchoService/Reverse
Reverses the message sent by the client.

**Request:**
```json
{
  "message": "Hello"
}
```

**Response:**
```json
{
  "message": "olleH"
}
```

### grpc.reflection.v1alpha.ServerReflection/ListServices
Lists all available gRPC services and methods (Server Reflection).

## Building

```bash
cd go/client/cmd/testclient
go build -o testclient
```

On Windows:
```bash
go build -o testclient.exe
```

## Usage

### Basic Usage

```bash
./testclient --server wss://your-worker.workers.dev/ws/app --api-key YOUR_API_KEY
```

### Local Development

```bash
./testclient --server ws://localhost:8787/ws/app --api-key YOUR_API_KEY
```

### Command Line Options

- `--server` - WebSocket server URL (default: `ws://localhost:8787/ws/app`)
- `--api-key` - API key for authentication (required)
- `--app-name` - Application name (default: `TestClient`)

### Example

```bash
# Production
./testclient \
  --server wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws/app \
  --api-key abc123xyz \
  --app-name "MyTestApp"

# Local development with Wrangler
./testclient \
  --server ws://localhost:8787/ws/app \
  --api-key test-key-123
```

## Architecture

```
Browser Client                    Test Client (Go)
      |                                 |
      | 1. Connect to Signaling Server  |
      |<--------------------------------|
      |                                 |
      | 2. Send WebRTC Offer           |
      |-------------------------------->|
      |                                 |
      | 3. Receive WebRTC Answer       |
      |<--------------------------------|
      |                                 |
      | 4. Establish P2P Connection    |
      |<===============================>|
      |                                 |
      | 5. gRPC-Web Request            |
      |-------------------------------->|
      |   (over DataChannel)            |
      |                                 |
      | 6. gRPC-Web Response           |
      |<--------------------------------|
      |                                 |
```

## How It Works

1. **WebSocket Connection**: The test client connects to the signaling server using the provided API key
2. **App Registration**: After authentication, the client registers itself as an app with capabilities `["grpc", "echo"]`
3. **Offer Handling**: When a browser sends a WebRTC offer, the client creates a PeerConnection and sends back an answer
4. **DataChannel Setup**: Once the DataChannel is established, the client sets up the gRPC-Web transport
5. **Service Registration**: The following handlers are registered:
   - Echo service (echoes messages)
   - Reverse service (reverses messages)
   - Server Reflection (lists available services)
6. **Request Handling**: Incoming gRPC-Web requests are routed to the appropriate handlers

## Testing with Browser

You can test this client using the browser examples in the `src/examples/grpc-client/` directory.

## Development

The test client demonstrates:
- Integration of `github.com/anthropics/cf-wbrtc-auth/go/client` (signaling and WebRTC)
- Integration of `github.com/anthropics/cf-wbrtc-auth/go/grpcweb` (gRPC-Web transport)
- JSON serialization for simple request/response handling
- Server Reflection for service discovery

For production use, you would typically:
- Use Protocol Buffers instead of JSON
- Implement proper service definitions
- Add authentication and authorization
- Add metrics and logging
- Handle errors more gracefully

## Troubleshooting

### Connection Issues

If you can't connect to the signaling server:
- Verify the server URL is correct
- Check that the API key is valid
- Ensure the server is running (for local development)

### DataChannel Not Opening

If the DataChannel doesn't open:
- Check browser console for WebRTC errors
- Verify STUN/TURN servers are accessible
- Check firewall settings

### gRPC Errors

If gRPC calls fail:
- Use the reflection endpoint to verify services are registered
- Check request format matches expected JSON structure
- Review server logs for error messages
