// Package main implements a test client for the Cloudflare Workers signaling server
// that handles WebRTC connections from browsers and exposes gRPC services.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/anthropics/cf-wbrtc-auth/go/client"
	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb"
)

// Default credentials file path
const defaultCredentialsFile = ".testclient-credentials"

// EchoRequest is the request message for Echo and Reverse methods
type EchoRequest struct {
	Message string `json:"message"`
}

// EchoResponse is the response message for Echo and Reverse methods
type EchoResponse struct {
	Message string `json:"message"`
}

// TestClientHandler implements client.EventHandler
type TestClientHandler struct {
	signalingClient   *client.SignalingClient
	activeConnections map[string]*client.PeerConnection
}

func NewTestClientHandler(sc *client.SignalingClient) *TestClientHandler {
	return &TestClientHandler{
		signalingClient:   sc,
		activeConnections: make(map[string]*client.PeerConnection),
	}
}

func (h *TestClientHandler) OnAuthenticated(payload client.AuthOKPayload) {
	log.Printf("✓ Authenticated as user: %s (type: %s)", payload.UserID, payload.Type)
}

func (h *TestClientHandler) OnAuthError(payload client.AuthErrorPayload) {
	log.Printf("✗ Auth error: %s", payload.Error)
}

func (h *TestClientHandler) OnAppRegistered(payload client.AppRegisteredPayload) {
	log.Printf("✓ App registered with ID: %s", payload.AppID)
	log.Println("Waiting for browser connections...")
}

func (h *TestClientHandler) OnOffer(sdp string, requestID string) {
	log.Printf("← Received WebRTC offer (requestID: %s)", requestID)

	// Create handler first so we can set pc reference after creation
	dcHandler := &DataChannelHandler{requestID: requestID}

	// Create a new peer connection for this offer
	pc, err := client.NewPeerConnection(client.PeerConfig{
		SignalingClient: h.signalingClient,
		Handler:         dcHandler,
	})
	if err != nil {
		log.Printf("✗ Failed to create peer connection: %v", err)
		return
	}

	// Set the PeerConnection reference in handler for OnOpen callback
	dcHandler.pc = pc

	// Store the connection
	h.activeConnections[requestID] = pc

	// Handle the offer
	if err := pc.HandleOffer(sdp, requestID); err != nil {
		log.Printf("✗ Failed to handle offer: %v", err)
		return
	}

	log.Printf("→ Sent answer for requestID: %s", requestID)
	// gRPC transport will be set up in DataChannelHandler.OnOpen()
}

func (h *TestClientHandler) OnAnswer(sdp string, appID string) {
	// Not used in app mode (only browsers receive answers)
}

func (h *TestClientHandler) OnICE(candidate json.RawMessage) {
	// ICE candidates are handled automatically by the peer connection
}

func (h *TestClientHandler) OnError(message string) {
	log.Printf("✗ Error: %s", message)
}

func (h *TestClientHandler) OnConnected() {
	log.Println("✓ Connected to signaling server")
}

func (h *TestClientHandler) OnDisconnected() {
	log.Println("✗ Disconnected from signaling server")
}

// DataChannelHandler implements client.DataChannelHandler
type DataChannelHandler struct {
	requestID string
	pc        *client.PeerConnection
	transport *grpcweb.Transport
}

func (h *DataChannelHandler) OnMessage(data []byte) {
	// Messages are handled by grpcweb.Transport
	// This callback is called BEFORE transport is set up, so we need to buffer or handle differently
	// However, once transport.Start() is called, this callback is replaced
	log.Printf("  [DataChannelHandler] Received message (%d bytes) - transport not ready yet", len(data))
}

func (h *DataChannelHandler) OnOpen() {
	log.Printf("✓ DataChannel opened for requestID: %s", h.requestID)

	// Immediately set up gRPC transport when DataChannel opens
	dc := h.pc.DataChannel()
	if dc == nil {
		log.Printf("✗ DataChannel is nil in OnOpen")
		return
	}

	log.Printf("✓ Setting up gRPC transport...")

	// Create grpcweb transport
	h.transport = grpcweb.NewTransport(dc, nil)

	// Setup handlers BEFORE starting transport
	setupGRPCHandlers(h.transport)

	// Start the transport - this will replace the OnMessage handler
	h.transport.Start()

	log.Printf("✓ gRPC-Web transport started for requestID: %s", h.requestID)
}

func (h *DataChannelHandler) OnClose() {
	log.Printf("✗ DataChannel closed for requestID: %s", h.requestID)
}

// setupGRPCHandlers sets up gRPC service handlers on the transport
func setupGRPCHandlers(transport *grpcweb.Transport) {
	// Register Echo handler
	echoHandler := grpcweb.MakeHandler(
		// Deserialize request
		func(data []byte) (EchoRequest, error) {
			var req EchoRequest
			err := json.Unmarshal(data, &req)
			return req, err
		},
		// Serialize response
		func(resp EchoResponse) ([]byte, error) {
			return json.Marshal(resp)
		},
		// Handle request
		func(ctx context.Context, req EchoRequest) (EchoResponse, error) {
			log.Printf("  Echo: %q", req.Message)
			return EchoResponse{Message: req.Message}, nil
		},
	)
	transport.RegisterHandler("/example.EchoService/Echo", echoHandler)

	// Register Reverse handler
	reverseHandler := grpcweb.MakeHandler(
		// Deserialize request
		func(data []byte) (EchoRequest, error) {
			var req EchoRequest
			err := json.Unmarshal(data, &req)
			return req, err
		},
		// Serialize response
		func(resp EchoResponse) ([]byte, error) {
			return json.Marshal(resp)
		},
		// Handle request
		func(ctx context.Context, req EchoRequest) (EchoResponse, error) {
			// Reverse the string
			runes := []rune(req.Message)
			for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
				runes[i], runes[j] = runes[j], runes[i]
			}
			reversed := string(runes)
			log.Printf("  Reverse: %q -> %q", req.Message, reversed)
			return EchoResponse{Message: reversed}, nil
		},
	)
	transport.RegisterHandler("/example.EchoService/Reverse", reverseHandler)

	// Register Server Reflection
	grpcweb.RegisterReflection(transport)

	log.Println("✓ Registered gRPC services:")
	log.Println("  - /example.EchoService/Echo")
	log.Println("  - /example.EchoService/Reverse")
	log.Println("  - /grpc.reflection.v1alpha.ServerReflection/ListServices (reflection)")
}


// getCredentialsPath returns the full path to credentials file
func getCredentialsPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return defaultCredentialsFile
	}
	return filepath.Join(homeDir, defaultCredentialsFile)
}

// getBaseURL extracts base URL from WebSocket URL (ws://host/ws/app -> https://host)
func getBaseURL(wsURL string) string {
	baseURL := wsURL
	baseURL = strings.Replace(baseURL, "wss://", "https://", 1)
	baseURL = strings.Replace(baseURL, "ws://", "http://", 1)
	// Remove path part
	if idx := strings.Index(baseURL, "/ws"); idx != -1 {
		baseURL = baseURL[:idx]
	}
	return baseURL
}

func main() {
	// Parse command line flags
	serverURL := flag.String("server", "wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws/app", "WebSocket server URL")
	apiKey := flag.String("api-key", "", "API key for authentication (auto-setup if empty)")
	appName := flag.String("app-name", "TestClient", "Application name")
	flag.Parse()

	actualAPIKey := *apiKey
	credPath := getCredentialsPath()

	// If no API key provided, try to load from file or run setup
	if actualAPIKey == "" {
		// Try to load from credentials file
		creds, err := client.LoadCredentials(credPath)
		if err == nil && creds.APIKey != "" {
			log.Printf("✓ Loaded API key from %s", credPath)
			actualAPIKey = creds.APIKey
		} else {
			// Run OAuth setup
			log.Println("No API key found. Starting OAuth setup...")
			baseURL := getBaseURL(*serverURL)
			log.Printf("Base URL: %s", baseURL)

			setupResult, err := client.Setup(context.Background(), client.SetupConfig{
				ServerURL: baseURL,
			})
			if err != nil {
				log.Fatalf("Setup failed: %v", err)
			}

			actualAPIKey = setupResult.APIKey

			// Save credentials for future use
			if err := client.SaveCredentials(credPath, setupResult); err != nil {
				log.Printf("Warning: failed to save credentials: %v", err)
			} else {
				log.Printf("✓ Credentials saved to %s", credPath)
			}
		}
	}

	log.Printf("Starting Test Client")
	log.Printf("Server: %s", *serverURL)
	log.Printf("App: %s", *appName)

	// Create signaling client
	config := client.ClientConfig{
		ServerURL:    *serverURL,
		APIKey:       actualAPIKey,
		AppName:      *appName,
		Capabilities: []string{"grpc", "echo"},
		PingInterval: 30 * time.Second,
	}

	signalingClient := client.NewSignalingClient(config)
	handler := NewTestClientHandler(signalingClient)
	config.Handler = handler
	signalingClient = client.NewSignalingClient(config)
	handler.signalingClient = signalingClient

	// Connect to signaling server
	ctx := context.Background()
	if err := signalingClient.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer signalingClient.Close()

	// Wait a bit for authentication and registration
	time.Sleep(1 * time.Second)

	log.Println("✓ Test client is running. Press Ctrl+C to exit.")

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("\nShutting down...")

	// Close all peer connections
	for requestID, pc := range handler.activeConnections {
		log.Printf("Closing connection: %s", requestID)
		pc.Close()
	}
}
