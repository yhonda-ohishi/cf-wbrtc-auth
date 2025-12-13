package client

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"
)

// E2E test configuration from environment variables
func getE2EConfig() (string, string, bool) {
	runE2E := os.Getenv("E2E_TEST") == "1"
	serverURL := os.Getenv("E2E_SERVER_URL")
	if serverURL == "" {
		serverURL = "ws://localhost:8787/ws/app"
	}
	apiKey := os.Getenv("E2E_API_KEY")
	return serverURL, apiKey, runE2E
}

// e2eHandler tracks all events during E2E testing
type e2eHandler struct {
	mu                   sync.Mutex
	authenticated        bool
	authOKPayload        *AuthOKPayload
	authError            string
	appRegistered        bool
	appRegisteredPayload *AppRegisteredPayload
	offers               []offerEvent
	answers              []answerEvent
	iceCandidates        []json.RawMessage
	errors               []string
	connected            bool
	disconnected         bool
	events               []string // Track order of events
}

type offerEvent struct {
	sdp       string
	requestID string
}

type answerEvent struct {
	sdp   string
	appID string
}

func (h *e2eHandler) OnAuthenticated(payload AuthOKPayload) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.authenticated = true
	h.authOKPayload = &payload
	h.events = append(h.events, "authenticated")
}

func (h *e2eHandler) OnAuthError(payload AuthErrorPayload) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.authError = payload.Error
	h.events = append(h.events, "auth_error")
}

func (h *e2eHandler) OnAppRegistered(payload AppRegisteredPayload) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.appRegistered = true
	h.appRegisteredPayload = &payload
	h.events = append(h.events, "app_registered")
}

func (h *e2eHandler) OnOffer(sdp string, requestID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.offers = append(h.offers, offerEvent{sdp: sdp, requestID: requestID})
	h.events = append(h.events, "offer")
}

func (h *e2eHandler) OnAnswer(sdp string, appID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.answers = append(h.answers, answerEvent{sdp: sdp, appID: appID})
	h.events = append(h.events, "answer")
}

func (h *e2eHandler) OnICE(candidate json.RawMessage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.iceCandidates = append(h.iceCandidates, candidate)
	h.events = append(h.events, "ice")
}

func (h *e2eHandler) OnError(message string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.errors = append(h.errors, message)
	h.events = append(h.events, "error")
}

func (h *e2eHandler) OnConnected() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connected = true
	h.events = append(h.events, "connected")
}

func (h *e2eHandler) OnDisconnected() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.disconnected = true
	h.events = append(h.events, "disconnected")
}

func (h *e2eHandler) getEventCount(eventName string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	count := 0
	for _, e := range h.events {
		if e == eventName {
			count++
		}
	}
	return count
}

func (h *e2eHandler) hasError(substr string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, e := range h.errors {
		if len(substr) == 0 || (len(e) > 0 && len(substr) > 0 && e == substr) {
			return true
		}
	}
	return false
}

// TestE2EWebSocketConnection tests basic WebSocket connection to the real server
func TestE2EWebSocketConnection(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       apiKey,
		AppName:      "E2ETestApp",
		Capabilities: []string{"print", "scrape"},
		Handler:      handler,
		PingInterval: 30 * time.Second,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Log("Connecting to server:", serverURL)
	err := client.Connect(ctx)
	if err != nil {
		t.Fatalf("Failed to connect to server: %v", err)
	}
	defer client.Close()

	// Wait for connection and authentication
	time.Sleep(2 * time.Second)

	handler.mu.Lock()
	connected := handler.connected
	authenticated := handler.authenticated
	appRegistered := handler.appRegistered
	authErrors := len(handler.errors)
	handler.mu.Unlock()

	// Verify connection
	if !connected {
		t.Error("OnConnected was not called")
	}

	// Verify authentication
	if !authenticated {
		t.Error("OnAuthenticated was not called - check API key validity")
		handler.mu.Lock()
		if handler.authError != "" {
			t.Logf("Auth error: %s", handler.authError)
		}
		handler.mu.Unlock()
	}

	// Verify app registration
	if !appRegistered {
		t.Error("OnAppRegistered was not called - app should auto-register after auth")
	}

	// Check for errors
	if authErrors > 0 {
		handler.mu.Lock()
		t.Logf("Received %d errors: %v", authErrors, handler.errors)
		handler.mu.Unlock()
	}

	// Verify client is fully connected
	if !client.IsConnected() {
		t.Error("Client.IsConnected() returned false after successful connection")
	}

	t.Log("E2E WebSocket connection test passed")
}

// TestE2EAuthenticationSuccess tests successful authentication flow
func TestE2EAuthenticationSuccess(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       apiKey,
		AppName:      "E2EAuthTestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 30 * time.Second,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Wait for auth messages
	time.Sleep(2 * time.Second)

	handler.mu.Lock()
	defer handler.mu.Unlock()

	if !handler.authenticated {
		t.Fatalf("Authentication failed")
	}

	if handler.authOKPayload == nil {
		t.Fatal("auth_ok payload is nil")
	}

	// Verify auth payload
	if handler.authOKPayload.Type != "app" {
		t.Errorf("Expected type 'app', got '%s'", handler.authOKPayload.Type)
	}

	if handler.authOKPayload.UserID == "" {
		t.Error("UserID should not be empty")
	}

	t.Logf("Authenticated as user: %s, type: %s", handler.authOKPayload.UserID, handler.authOKPayload.Type)

	// Verify app registration
	if !handler.appRegistered {
		t.Error("App was not registered after authentication")
	}

	if handler.appRegisteredPayload == nil {
		t.Fatal("app_registered payload is nil")
	}

	if handler.appRegisteredPayload.AppID == "" {
		t.Error("AppID should not be empty")
	}

	t.Logf("App registered with ID: %s", handler.appRegisteredPayload.AppID)
}

// TestE2EAuthenticationFailure tests authentication with invalid API key
func TestE2EAuthenticationFailure(t *testing.T) {
	serverURL, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       "invalid-api-key-12345",
		AppName:      "E2EFailTestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 30 * time.Second,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Logf("Connection failed as expected: %v", err)
		return
	}
	defer client.Close()

	// Wait for auth response
	time.Sleep(2 * time.Second)

	handler.mu.Lock()
	defer handler.mu.Unlock()

	// Should not be authenticated with invalid key
	if handler.authenticated {
		t.Error("Should not authenticate with invalid API key")
	}

	// Should receive auth error
	if handler.authError == "" {
		t.Log("Warning: Expected auth error message, but got none")
	} else {
		t.Logf("Received expected auth error: %s", handler.authError)
	}

	// Client should not report as connected after auth failure
	if client.IsConnected() {
		t.Error("Client.IsConnected() should return false after auth failure")
	}
}

// TestE2EConnectionPersistence tests that connection stays alive
func TestE2EConnectionPersistence(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       apiKey,
		AppName:      "E2EPersistenceTestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 5 * time.Second, // Faster ping for testing
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Wait for initial connection
	time.Sleep(2 * time.Second)

	if !client.IsConnected() {
		t.Fatal("Client not connected after initial wait")
	}

	// Wait for multiple ping intervals to ensure connection stays alive
	t.Log("Testing connection persistence over 15 seconds...")
	for i := 0; i < 3; i++ {
		time.Sleep(5 * time.Second)
		if !client.IsConnected() {
			t.Errorf("Connection lost after %d seconds", (i+1)*5)
		}
		t.Logf("Connection still alive after %d seconds", (i+1)*5)
	}

	handler.mu.Lock()
	disconnected := handler.disconnected
	handler.mu.Unlock()

	if disconnected {
		t.Error("Connection was unexpectedly disconnected during test")
	}
}

// TestE2EReconnection tests reconnection behavior
func TestE2EReconnection(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       apiKey,
		AppName:      "E2EReconnectTestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 30 * time.Second,
	}

	client := NewSignalingClient(config)

	// First connection
	ctx1, cancel1 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel1()

	t.Log("Establishing first connection...")
	err := client.Connect(ctx1)
	if err != nil {
		t.Fatalf("First connection failed: %v", err)
	}

	time.Sleep(2 * time.Second)

	if !client.IsConnected() {
		t.Fatal("First connection failed to authenticate")
	}

	handler.mu.Lock()
	firstAuthCount := handler.getEventCount("authenticated")
	handler.mu.Unlock()

	// Close connection
	t.Log("Closing connection...")
	client.Close()
	time.Sleep(1 * time.Second)

	handler.mu.Lock()
	disconnected := handler.disconnected
	handler.mu.Unlock()

	if !disconnected {
		t.Error("OnDisconnected was not called after Close()")
	}

	if client.IsConnected() {
		t.Error("Client should not report as connected after Close()")
	}

	// Reconnect
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel2()

	t.Log("Reconnecting...")
	err = client.Connect(ctx2)
	if err != nil {
		t.Fatalf("Reconnection failed: %v", err)
	}
	defer client.Close()

	time.Sleep(2 * time.Second)

	if !client.IsConnected() {
		t.Fatal("Reconnection failed to authenticate")
	}

	handler.mu.Lock()
	secondAuthCount := handler.getEventCount("authenticated")
	handler.mu.Unlock()

	if secondAuthCount <= firstAuthCount {
		t.Error("Expected second authentication event after reconnection")
	}

	t.Log("Reconnection test passed")
}

// TestE2ESendAnswer tests sending WebRTC answer
func TestE2ESendAnswer(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       apiKey,
		AppName:      "E2EAnswerTestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 30 * time.Second,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	time.Sleep(2 * time.Second)

	if !client.IsConnected() {
		t.Fatal("Client not connected")
	}

	// Send a test answer (won't be processed without an offer, but tests the send mechanism)
	testSDP := "v=0\r\no=- 123456 0 IN IP4 127.0.0.1\r\ns=-\r\n"
	err = client.SendAnswer(testSDP, "test-request-id")
	if err != nil {
		t.Errorf("Failed to send answer: %v", err)
	}

	t.Log("Successfully sent answer message")
}

// TestE2ESendICE tests sending ICE candidates
func TestE2ESendICE(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	handler := &e2eHandler{}
	config := ClientConfig{
		ServerURL:    serverURL,
		APIKey:       apiKey,
		AppName:      "E2EICETestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 30 * time.Second,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	time.Sleep(2 * time.Second)

	if !client.IsConnected() {
		t.Fatal("Client not connected")
	}

	// Send a test ICE candidate
	testCandidate := json.RawMessage(`{"candidate":"test-candidate","sdpMid":"0","sdpMLineIndex":0}`)
	err = client.SendICE(testCandidate)
	if err != nil {
		t.Errorf("Failed to send ICE candidate: %v", err)
	}

	t.Log("Successfully sent ICE candidate message")
}

// TestE2EMultipleClients tests multiple concurrent clients
func TestE2EMultipleClients(t *testing.T) {
	serverURL, apiKey, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	if apiKey == "" {
		t.Fatal("E2E_API_KEY environment variable is required for E2E tests")
	}

	numClients := 3
	clients := make([]*SignalingClient, numClients)
	handlers := make([]*e2eHandler, numClients)

	t.Logf("Creating %d concurrent clients...", numClients)

	// Create and connect multiple clients
	for i := 0; i < numClients; i++ {
		handlers[i] = &e2eHandler{}
		config := ClientConfig{
			ServerURL:    serverURL,
			APIKey:       apiKey,
			AppName:      "E2EMultiTestApp",
			Capabilities: []string{"test"},
			Handler:      handlers[i],
			PingInterval: 30 * time.Second,
		}

		clients[i] = NewSignalingClient(config)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		err := clients[i].Connect(ctx)
		if err != nil {
			t.Errorf("Client %d failed to connect: %v", i, err)
		}
		defer clients[i].Close()
	}

	// Wait for all connections
	time.Sleep(3 * time.Second)

	// Verify all clients are connected
	successCount := 0
	for i := 0; i < numClients; i++ {
		if clients[i].IsConnected() {
			successCount++
		}
	}

	if successCount != numClients {
		t.Errorf("Expected %d clients connected, got %d", numClients, successCount)
	} else {
		t.Logf("All %d clients successfully connected", numClients)
	}

	// Close all clients
	for i := 0; i < numClients; i++ {
		clients[i].Close()
	}

	time.Sleep(1 * time.Second)

	// Verify all disconnected
	for i := 0; i < numClients; i++ {
		handlers[i].mu.Lock()
		disconnected := handlers[i].disconnected
		handlers[i].mu.Unlock()
		if !disconnected {
			t.Errorf("Client %d did not properly disconnect", i)
		}
	}
}
