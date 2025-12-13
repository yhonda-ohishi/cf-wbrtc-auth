import { Hono } from 'hono';
import { authRoutes } from './auth/oauth';
import { setupRoutes } from './setup';
import { appRoutes } from './api/apps';
import { SignalingDO } from './do/signaling';

type Env = {
  KV: KVNamespace;
  SIGNALING_DO: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

// Management UI HTML (embedded)
function getManagementUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebRTC Signaling - Management UI</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }

    .header h1 {
      font-size: 2em;
      margin-bottom: 10px;
    }

    .header p {
      opacity: 0.9;
      font-size: 1.1em;
    }

    .section {
      padding: 30px;
      border-bottom: 1px solid #e0e0e0;
    }

    .section:last-child {
      border-bottom: none;
    }

    .section-title {
      font-size: 1.5em;
      margin-bottom: 20px;
      color: #667eea;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 1em;
      cursor: pointer;
      transition: all 0.3s ease;
      font-weight: 500;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }

    .btn-primary {
      background: #667eea;
      color: white;
    }

    .btn-primary:hover {
      background: #5568d3;
    }

    .btn-danger {
      background: #e53e3e;
      color: white;
    }

    .btn-danger:hover {
      background: #c53030;
    }

    .btn-secondary {
      background: #718096;
      color: white;
    }

    .btn-secondary:hover {
      background: #4a5568;
    }

    .login-box {
      text-align: center;
      padding: 60px 30px;
    }

    .login-box h2 {
      margin-bottom: 20px;
      color: #667eea;
    }

    .login-box p {
      margin-bottom: 30px;
      color: #666;
    }

    .user-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 20px;
      background: #f7fafc;
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .user-info .user-details {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      background: #667eea;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2em;
      font-weight: bold;
    }

    .ws-status {
      padding: 15px 20px;
      background: #f7fafc;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ws-status-label {
      font-weight: 500;
    }

    .status-connected {
      color: #38a169;
    }

    .status-authenticated {
      color: #38a169;
    }

    .status-disconnected {
      color: #e53e3e;
    }

    .status-error {
      color: #e53e3e;
    }

    .app-card {
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      transition: all 0.3s ease;
    }

    .app-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }

    .app-card.online {
      border-color: #48bb78;
    }

    .app-card.offline {
      opacity: 0.7;
    }

    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .app-name {
      font-size: 1.2em;
      font-weight: 600;
      color: #2d3748;
    }

    .app-status {
      font-size: 0.9em;
      font-weight: 500;
    }

    .status-online {
      color: #38a169;
    }

    .status-offline {
      color: #a0aec0;
    }

    .app-details {
      margin: 15px 0;
      font-size: 0.9em;
      color: #666;
    }

    .app-details > div {
      margin-bottom: 5px;
    }

    .app-id {
      font-family: monospace;
      background: #f7fafc;
      padding: 5px 8px;
      border-radius: 4px;
      display: inline-block;
    }

    .app-capabilities {
      color: #4a5568;
    }

    .app-connection-state,
    .app-datachannel-state {
      font-family: monospace;
      font-size: 0.85em;
    }

    .app-actions {
      margin-top: 15px;
      display: flex;
      gap: 10px;
    }

    .no-apps {
      text-align: center;
      color: #a0aec0;
      padding: 40px 20px;
      font-size: 1.1em;
    }

    .message-controls {
      margin-bottom: 20px;
    }

    .form-group {
      margin-bottom: 15px;
    }

    .form-group label {
      display: block;
      margin-bottom: 5px;
      font-weight: 500;
      color: #4a5568;
    }

    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 10px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 1em;
      font-family: inherit;
      transition: border-color 0.3s ease;
    }

    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
    }

    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }

    .button-group {
      display: flex;
      gap: 10px;
    }

    .message-log {
      background: #f7fafc;
      border-radius: 8px;
      padding: 20px;
      max-height: 400px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.9em;
    }

    .log-entry {
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      gap: 10px;
    }

    .log-entry:last-child {
      border-bottom: none;
    }

    .log-time {
      color: #a0aec0;
      min-width: 80px;
    }

    .log-direction {
      min-width: 20px;
      text-align: center;
      font-weight: bold;
    }

    .log-app {
      color: #667eea;
      min-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .log-data {
      flex: 1;
      word-break: break-all;
    }

    .log-sent .log-direction {
      color: #3182ce;
    }

    .log-received .log-direction {
      color: #38a169;
    }

    .empty-log {
      text-align: center;
      color: #a0aec0;
      padding: 40px 20px;
    }

    @media (max-width: 768px) {
      body {
        padding: 10px;
      }

      .section {
        padding: 20px;
      }

      .app-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
      }

      .button-group {
        flex-direction: column;
      }

      .log-entry {
        flex-wrap: wrap;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>WebRTC Signaling</h1>
      <p>Management UI for WebRTC P2P Communication</p>
    </div>

    <!-- Login Section -->
    <div id="login-section" class="section" style="display: none;">
      <div class="login-box">
        <h2>Welcome</h2>
        <p>Please log in to access the management interface</p>
        <button id="login-btn" class="btn btn-primary">Login with Google</button>
      </div>
    </div>

    <!-- User Section -->
    <div id="user-section" class="section" style="display: none;">
      <div class="user-info">
        <div class="user-details">
          <div class="user-avatar">U</div>
          <div>
            <div style="font-weight: 500;">Logged in as</div>
            <div id="user-email" style="color: #667eea;"></div>
          </div>
        </div>
        <button id="logout-btn" class="btn btn-secondary">Logout</button>
      </div>

      <div class="ws-status">
        <span class="ws-status-label">WebSocket Status:</span>
        <span id="ws-status" class="status-disconnected">disconnected</span>
      </div>
    </div>

    <!-- App List Section -->
    <div id="app-list-section" class="section" style="display: none;">
      <div class="section-title">
        <span>Registered Apps</span>
        <button id="refresh-apps-btn" class="btn btn-secondary">Refresh</button>
      </div>
      <div id="app-list"></div>
    </div>

    <!-- Connection Section (Combined with App List) -->
    <div id="connection-section" style="display: none;">
      <!-- Connection info is shown in app cards -->
    </div>

    <!-- Message Section -->
    <div id="message-section" class="section" style="display: none;">
      <div class="section-title">Test Messages</div>

      <div class="message-controls">
        <div class="form-group">
          <label for="target-app">Target App:</label>
          <select id="target-app">
            <option value="">-- Select App --</option>
          </select>
        </div>

        <div class="form-group">
          <label for="message-input">Message:</label>
          <textarea id="message-input" placeholder="Type your message here..."></textarea>
        </div>

        <div class="button-group">
          <button id="send-message-btn" class="btn btn-primary">Send Message</button>
          <button id="clear-log-btn" class="btn btn-secondary">Clear Log</button>
        </div>
      </div>

      <div class="section-title" style="margin-top: 30px;">Message Log</div>
      <div id="message-log" class="message-log">
        <div class="empty-log">No messages yet</div>
      </div>
    </div>
  </div>

  <script type="module" src="/client.js"></script>
</body>
</html>`;
}

// Reflection Test UI HTML (embedded)
function getReflectionTestUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>gRPC Server Reflection Test</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }

    .header h1 {
      font-size: 2em;
      margin-bottom: 10px;
    }

    .header p {
      opacity: 0.9;
      font-size: 1.1em;
    }

    .section {
      padding: 30px;
      border-bottom: 1px solid #e0e0e0;
    }

    .section:last-child {
      border-bottom: none;
    }

    .section-title {
      font-size: 1.5em;
      margin-bottom: 20px;
      color: #667eea;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 1em;
      cursor: pointer;
      transition: all 0.3s ease;
      font-weight: 500;
    }

    .btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: #667eea;
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: #5568d3;
    }

    .btn-secondary {
      background: #718096;
      color: white;
    }

    .btn-secondary:hover:not(:disabled) {
      background: #4a5568;
    }

    .login-box {
      text-align: center;
      padding: 60px 30px;
    }

    .login-box h2 {
      margin-bottom: 20px;
      color: #667eea;
    }

    .login-box p {
      margin-bottom: 30px;
      color: #666;
    }

    .user-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 20px;
      background: #f7fafc;
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .user-info .user-details {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      background: #667eea;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2em;
      font-weight: bold;
    }

    .ws-status {
      padding: 15px 20px;
      background: #f7fafc;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ws-status-label {
      font-weight: 500;
    }

    .status-connected {
      color: #38a169;
    }

    .status-authenticated {
      color: #38a169;
    }

    .status-disconnected {
      color: #e53e3e;
    }

    .status-error {
      color: #e53e3e;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: #4a5568;
    }

    .form-group select {
      width: 100%;
      padding: 10px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 1em;
      font-family: inherit;
      transition: border-color 0.3s ease;
    }

    .form-group select:focus {
      outline: none;
      border-color: #667eea;
    }

    .status-message {
      padding: 12px 20px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-weight: 500;
    }

    .status-info {
      background: #ebf8ff;
      color: #2c5282;
      border: 1px solid #90cdf4;
    }

    .status-success {
      background: #f0fff4;
      color: #22543d;
      border: 1px solid #9ae6b4;
    }

    .status-error {
      background: #fff5f5;
      color: #742a2a;
      border: 1px solid #fc8181;
    }

    .results-container {
      background: #f7fafc;
      border-radius: 8px;
      padding: 20px;
      min-height: 200px;
    }

    .no-results {
      text-align: center;
      color: #a0aec0;
      padding: 40px 20px;
      font-size: 1.1em;
    }

    .results-header {
      font-size: 1.2em;
      font-weight: 600;
      color: #2d3748;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e0e0e0;
    }

    .services-container {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .service-card {
      background: white;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      transition: all 0.3s ease;
    }

    .service-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }

    .service-name {
      font-size: 1.3em;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }

    .methods-header {
      font-weight: 500;
      color: #4a5568;
      margin-bottom: 10px;
    }

    .methods-list {
      list-style: none;
      padding-left: 20px;
    }

    .method-item {
      padding: 8px 0;
      color: #2d3748;
      border-bottom: 1px solid #e0e0e0;
      font-family: 'Courier New', monospace;
      font-size: 0.95em;
    }

    .method-item:last-child {
      border-bottom: none;
    }

    .method-item:before {
      content: '▸ ';
      color: #667eea;
      font-weight: bold;
    }

    .no-methods {
      color: #a0aec0;
      font-style: italic;
      padding: 10px 0;
    }

    .results-footer {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
      text-align: center;
    }

    .raw-json {
      background: #2d3748;
      color: #a0aec0;
      padding: 20px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    @media (max-width: 768px) {
      body {
        padding: 10px;
      }

      .section {
        padding: 20px;
      }

      .header h1 {
        font-size: 1.5em;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>gRPC Server Reflection Test</h1>
      <p>Connect to a Go App and list available gRPC services</p>
    </div>

    <!-- Login Section -->
    <div id="login-section" class="section" style="display: none;">
      <div class="login-box">
        <h2>Welcome</h2>
        <p>Please log in to access the reflection test interface</p>
        <button id="login-btn" class="btn btn-primary">Login with Google</button>
      </div>
    </div>

    <!-- User Section -->
    <div id="user-section" class="section" style="display: none;">
      <div class="user-info">
        <div class="user-details">
          <div class="user-avatar">U</div>
          <div>
            <div style="font-weight: 500;">Logged in as</div>
            <div id="user-email" style="color: #667eea;"></div>
          </div>
        </div>
        <button id="logout-btn" class="btn btn-secondary">Logout</button>
      </div>

      <div class="ws-status">
        <span class="ws-status-label">WebSocket Status:</span>
        <span id="ws-status" class="status-disconnected">disconnected</span>
      </div>
    </div>

    <!-- App List Section -->
    <div id="app-list-section" class="section" style="display: none;">
      <div class="section-title">Select an App</div>

      <div class="form-group">
        <label for="app-select">Choose an online app to connect to:</label>
        <select id="app-select">
          <option value="">-- Select an Online App --</option>
        </select>
      </div>

      <button id="connect-btn" class="btn btn-primary" disabled>Connect & List Services</button>
    </div>

    <!-- Reflection Section -->
    <div id="reflection-section" class="section" style="display: none;">
      <div class="section-title">Results</div>

      <div id="status" class="status-message status-info" style="display: none;"></div>

      <div id="results" class="results-container">
        <div class="no-results">No results yet. Select an app and click "Connect & List Services".</div>
      </div>
    </div>
  </div>

  <script type="module" src="/reflection-client.js"></script>
</body>
</html>`;
}

// Auth routes
app.route('/auth', authRoutes);

// Setup routes (Go App initial setup)
app.route('/setup', setupRoutes);

// API routes
app.route('/api', appRoutes);

// WebSocket routes
app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const token = c.req.query('token');
  if (!token) {
    return c.text('Missing token', 401);
  }

  const id = c.env.SIGNALING_DO.idFromName('global');
  const stub = c.env.SIGNALING_DO.get(id);
  return stub.fetch(c.req.raw);
});

app.get('/ws/app', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const apiKey = c.req.query('apiKey');
  if (!apiKey) {
    return c.text('Missing API key', 401);
  }

  // Validate API key
  const keyData = await c.env.KV.get(`apikey:${apiKey}`, 'json');
  if (!keyData) {
    return c.text('Invalid API key', 401);
  }

  const id = c.env.SIGNALING_DO.idFromName('global');
  const stub = c.env.SIGNALING_DO.get(id);
  return stub.fetch(c.req.raw);
});

// Serve management UI
app.get('/', async (c) => {
  return c.html(getManagementUI());
});

// Client JS bundle - embedded at build time
// To update: run `npm run build:client` and paste the output here
// Or use wrangler assets binding for dynamic serving
import { CLIENT_JS } from './client/bundle';
import { REFLECTION_CLIENT_JS } from './client/reflection-bundle';

app.get('/client.js', async (c) => {
  return new Response(CLIENT_JS, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  });
});

// Reflection Test UI
app.get('/reflection', async (c) => {
  return c.html(getReflectionTestUI());
});

app.get('/reflection-client.js', async (c) => {
  return new Response(REFLECTION_CLIENT_JS, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  });
});

// Static files fallback
app.get('/*', async (c) => {
  return c.text('Not found', 404);
});

export default app;
export { SignalingDO };
