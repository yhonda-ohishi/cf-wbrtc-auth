# Quick Start Guide

## Build

```bash
cd go/client/cmd/testclient
go build -o testclient
```

## Run

### Local Development (with Wrangler)

```bash
# Terminal 1: Start Wrangler dev server
cd src
npx wrangler dev

# Terminal 2: Start test client
cd go/client/cmd/testclient
./testclient --server ws://localhost:8787/ws/app --api-key YOUR_API_KEY
```

### Production

```bash
./testclient \
  --server wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws/app \
  --api-key YOUR_API_KEY \
  --app-name "MyApp"
```

## Testing from Browser

1. Open your browser DevTools console

2. Connect and test:

```javascript
// Create WebRTC connection to the test client
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

const dc = pc.createDataChannel('grpc');

dc.onopen = async () => {
  console.log('DataChannel opened');
  
  // Test Echo service
  const echoResponse = await callGRPC('/example.EchoService/Echo', {
    message: 'Hello, World!'
  });
  console.log('Echo response:', echoResponse);
  
  // Test Reverse service
  const reverseResponse = await callGRPC('/example.EchoService/Reverse', {
    message: 'Hello'
  });
  console.log('Reverse response:', reverseResponse);
  
  // Test Server Reflection
  const services = await callGRPC('/grpc.reflection.v1alpha.ServerReflection/ListServices', {});
  console.log('Available services:', services);
};

// Helper function to call gRPC-Web over DataChannel
async function callGRPC(path, request) {
  // Implement gRPC-Web client logic here
  // See browser examples in src/examples/grpc-client/
}

// Complete WebRTC signaling via WebSocket
// (see full example in src/examples/)
```

## Verify It's Working

Expected console output:

```
Starting Test Client
Server: ws://localhost:8787/ws/app
App: TestClient
✓ Connected to signaling server
✓ Authenticated as user: user-abc123 (type: app)
✓ App registered with ID: app-xyz789
Waiting for browser connections...
✓ Test client is running. Press Ctrl+C to exit.

← Received WebRTC offer (requestID: req-123)
→ Sent answer for requestID: req-123
✓ DataChannel opened for requestID: req-123
✓ DataChannel ready, setting up gRPC transport...
✓ Registered gRPC services:
  - /example.EchoService/Echo
  - /example.EchoService/Reverse
  - /grpc.reflection.v1alpha.ServerReflection/ListServices (reflection)
✓ gRPC-Web transport started for requestID: req-123

  Echo: "Hello, World!"
  Reverse: "Hello" -> "olleH"
```

## Troubleshooting

### Cannot connect to server
- Check if Wrangler is running
- Verify the server URL and API key
- Check firewall settings

### DataChannel not opening
- Check browser console for errors
- Verify WebRTC signaling completed
- Check STUN server accessibility

### gRPC calls failing
- Use reflection endpoint to verify services are registered
- Check request format (should be JSON)
- Review client logs for errors

## Next Steps

- See [README.md](README.md) for detailed documentation
- See [IMPLEMENTATION.md](IMPLEMENTATION.md) for technical details
- Check [src/examples/grpc-client/](../../../examples/grpc-client/) for browser examples
