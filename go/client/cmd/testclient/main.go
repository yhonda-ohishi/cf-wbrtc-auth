// Package main implements a test client for the Cloudflare Workers signaling server
// that handles WebRTC connections from browsers and exposes gRPC services.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/anthropics/cf-wbrtc-auth/go/client"
	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb"
)

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

	// Create a new peer connection for this offer
	pc, err := client.NewPeerConnection(client.PeerConfig{
		SignalingClient: h.signalingClient,
		Handler:         &DataChannelHandler{requestID: requestID},
	})
	if err != nil {
		log.Printf("✗ Failed to create peer connection: %v", err)
		return
	}

	// Store the connection
	h.activeConnections[requestID] = pc

	// Handle the offer
	if err := pc.HandleOffer(sdp, requestID); err != nil {
		log.Printf("✗ Failed to handle offer: %v", err)
		return
	}

	log.Printf("→ Sent answer for requestID: %s", requestID)

	// Monitor and setup gRPC transport when DataChannel is ready
	go monitorDataChannelSetup(pc, requestID)
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
}

func (h *DataChannelHandler) OnMessage(data []byte) {
	// Messages are handled by grpcweb.Transport
}

func (h *DataChannelHandler) OnOpen() {
	log.Printf("✓ DataChannel opened for requestID: %s", h.requestID)
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

// monitorDataChannelSetup waits for the DataChannel to be established and sets up gRPC transport
func monitorDataChannelSetup(pc *client.PeerConnection, requestID string) {
	// Poll for DataChannel to be ready
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	timeout := time.After(10 * time.Second)

	for {
		select {
		case <-ticker.C:
			dc := pc.DataChannel()
			if dc != nil && dc.ReadyState() == 1 { // 1 = Open
				log.Printf("✓ DataChannel ready, setting up gRPC transport...")

				// Create grpcweb transport
				transport := grpcweb.NewTransport(dc, nil)

				// Setup handlers
				setupGRPCHandlers(transport)

				// Start the transport
				transport.Start()

				log.Printf("✓ gRPC-Web transport started for requestID: %s", requestID)
				return
			}
		case <-timeout:
			log.Printf("✗ Timeout waiting for DataChannel to be ready")
			return
		}
	}
}

func main() {
	// Parse command line flags
	serverURL := flag.String("server", "ws://localhost:8787/ws/app", "WebSocket server URL")
	apiKey := flag.String("api-key", "", "API key for authentication")
	appName := flag.String("app-name", "TestClient", "Application name")
	flag.Parse()

	if *apiKey == "" {
		fmt.Fprintf(os.Stderr, "Error: --api-key is required\n")
		flag.Usage()
		os.Exit(1)
	}

	log.Printf("Starting Test Client")
	log.Printf("Server: %s", *serverURL)
	log.Printf("App: %s", *appName)

	// Create signaling client
	config := client.ClientConfig{
		ServerURL:    *serverURL,
		APIKey:       *apiKey,
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
