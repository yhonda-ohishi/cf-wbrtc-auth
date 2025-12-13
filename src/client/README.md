# Browser Client for WebRTC Signaling

This directory contains the browser-side client code for the WebRTC signaling system.

## Files

- **index.html** - Static HTML page with embedded CSS (served by Workers at `/`)
- **ws-client.ts** - WebSocket client for signaling server communication
- **webrtc-client.ts** - WebRTC client for P2P DataChannel connections
- **ui.ts** - UI logic that manages SignalingClient and WebRTCClient
- **index.ts** - Entry point that exports all client modules

## Architecture

```
┌──────────────┐
│  index.html  │  ← Served by Workers at /
└──────┬───────┘
       │ loads
       ▼
┌──────────────┐
│  client.js   │  ← Bundled JavaScript (from index.ts)
└──────┬───────┘
       │ imports
       ▼
┌─────────────────────────────────┐
│  ui.ts                          │
│  - UIManager class              │
│  - Manages UI state             │
│  - Initializes clients          │
└──────┬──────────────────────────┘
       │ uses
       ├──────────┬───────────────┐
       ▼          ▼               ▼
┌──────────┐ ┌────────────┐ ┌─────────┐
│ ws-client│ │webrtc-client│ │ DOM API │
└──────────┘ └────────────┘ └─────────┘
```

## Building the Client Bundle

The client code needs to be bundled into a single JavaScript file that can be served by the Workers.

### Option 1: Using esbuild (Recommended)

Install esbuild:
```bash
npm install --save-dev esbuild
```

Add to package.json scripts:
```json
{
  "scripts": {
    "build:client": "esbuild src/client/index.ts --bundle --format=esm --outfile=public/client.js",
    "build": "npm run build:client && wrangler deploy"
  }
}
```

Build:
```bash
npm run build:client
```

### Option 2: Using Wrangler with Assets

Configure wrangler.toml to serve static assets:
```toml
[assets]
directory = "./public"
binding = "ASSETS"
```

Then modify src/index.ts to serve from ASSETS binding instead of embedding HTML.

### Option 3: Manual Bundling with Webpack

Install webpack:
```bash
npm install --save-dev webpack webpack-cli ts-loader
```

Create webpack.config.js:
```javascript
module.exports = {
  entry: './src/client/index.ts',
  output: {
    filename: 'client.js',
    path: __dirname + '/public',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
};
```

## Usage

### For Development

1. Build the client bundle
2. Run wrangler dev:
   ```bash
   npm run dev
   ```
3. Open browser to `http://localhost:8787/`

### For Production

1. Build the client bundle
2. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

## UI Features

### 1. Login/Auth Section
- Google OAuth login button
- Redirects to `/auth/login`
- Shows user info when authenticated

### 2. App List Section
- Displays registered apps with status (online/offline)
- Real-time status updates via WebSocket
- Shows app ID, name, and capabilities

### 3. Connection Section
- Connect button for online apps
- Shows WebRTC connection state
- Shows DataChannel state
- Disconnect button for connected apps

### 4. Test Message Section
- Dropdown to select connected app
- Text area to compose messages
- Send button to send via DataChannel
- Message log showing sent/received messages
- Clear log button

## API Integration

The UI integrates with the following endpoints:

- `GET /api/me` - Get current user info
- `GET /api/apps` - Get list of user's apps
- `WS /ws?token={jwt}` - WebSocket signaling connection

## Authentication

The UI checks for JWT token in the following order:

1. Cookie named `auth_token`
2. localStorage key `auth_token`

The token is sent with all API requests in the `Authorization` header.

## WebSocket Messages

The client handles these message types:

- `auth_ok` - Authentication successful
- `auth_error` - Authentication failed
- `apps_list` - List of apps received
- `app_status` - App status update (online/offline)
- `offer` - WebRTC offer from app
- `answer` - WebRTC answer from app
- `ice` - ICE candidate from app
- `error` - Error message

## WebRTC Flow

1. User clicks "Connect" button for an online app
2. Browser creates RTCPeerConnection
3. Browser creates DataChannel
4. Browser creates SDP offer
5. Offer sent to app via signaling server
6. App responds with SDP answer
7. ICE candidates exchanged
8. DataChannel opens
9. User can send/receive messages

## Customization

### Styling
All CSS is embedded in the HTML file. Modify the `<style>` tag in `index.html`.

### ICE Servers
Default ICE servers are Google's STUN servers. To use custom TURN servers, modify the `DEFAULT_ICE_SERVERS` in `webrtc-client.ts`.

### WebSocket URL
The UI automatically constructs the WebSocket URL based on the current page URL (uses `wss://` for HTTPS, `ws://` for HTTP).

## Browser Compatibility

- Modern browsers with WebRTC support (Chrome, Firefox, Safari, Edge)
- WebSocket support required
- ES6+ JavaScript support required

## Security Considerations

- Always use HTTPS/WSS in production
- JWT tokens are stored in cookies/localStorage (consider using httpOnly cookies for production)
- CORS is handled by Cloudflare Workers
- XSS protection via HTML escaping in UI rendering
