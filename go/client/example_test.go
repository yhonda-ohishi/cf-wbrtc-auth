package client_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	client "github.com/anthropics/cf-wbrtc-auth/go/client"
)

// AppHandler implements both EventHandler and DataChannelHandler
type AppHandler struct {
	signalingClient *client.SignalingClient
	peerConnection  *client.PeerConnection
}

// EventHandler implementation
func (h *AppHandler) OnAuthenticated(payload client.AuthOKPayload) {
	log.Printf("Authenticated as %s (type: %s)", payload.UserID, payload.Type)
}

func (h *AppHandler) OnAuthError(payload client.AuthErrorPayload) {
	log.Printf("Auth error: %s", payload.Error)
}

func (h *AppHandler) OnAppRegistered(payload client.AppRegisteredPayload) {
	log.Printf("App registered with ID: %s", payload.AppID)
}

func (h *AppHandler) OnOffer(sdp string, requestID string) {
	log.Printf("Received WebRTC offer (requestID: %s)", requestID)

	// Create peer connection if not exists
	if h.peerConnection == nil {
		pc, err := client.NewPeerConnection(client.PeerConfig{
			SignalingClient: h.signalingClient,
			Handler:         h,
		})
		if err != nil {
			log.Printf("Failed to create peer connection: %v", err)
			return
		}
		h.peerConnection = pc
	}

	// Handle the offer
	if err := h.peerConnection.HandleOffer(sdp, requestID); err != nil {
		log.Printf("Failed to handle offer: %v", err)
	}
}

func (h *AppHandler) OnAnswer(sdp string, appID string) {
	log.Printf("Received answer from app %s", appID)
}

func (h *AppHandler) OnICE(candidate json.RawMessage) {
	log.Printf("Received ICE candidate")
	if h.peerConnection != nil {
		if err := h.peerConnection.AddICECandidate(candidate); err != nil {
			log.Printf("Failed to add ICE candidate: %v", err)
		}
	}
}

func (h *AppHandler) OnError(message string) {
	log.Printf("Error: %s", message)
}

func (h *AppHandler) OnConnected() {
	log.Println("Connected to signaling server")
}

func (h *AppHandler) OnDisconnected() {
	log.Println("Disconnected from signaling server")
}

// DataChannelHandler implementation
func (h *AppHandler) OnMessage(data []byte) {
	log.Printf("Received data: %s", string(data))

	// Echo back
	if h.peerConnection != nil {
		response := fmt.Sprintf("Echo: %s", string(data))
		h.peerConnection.SendText(response)
	}
}

func (h *AppHandler) OnOpen() {
	log.Println("Data channel opened")
}

func (h *AppHandler) OnClose() {
	log.Println("Data channel closed")
}

func ExampleSetup() {
	// Perform initial setup with polling
	setupConfig := client.SetupConfig{
		ServerURL:    "https://your-worker.example.com",
		PollInterval: 2 * time.Second,
		Timeout:      5 * time.Minute,
	}

	ctx := context.Background()

	result, err := client.Setup(ctx, setupConfig)
	if err != nil {
		log.Fatalf("Setup failed: %v", err)
	}

	// Save credentials for future use
	credPath := "credentials.env"
	if err := client.SaveCredentials(credPath, result); err != nil {
		log.Fatalf("Failed to save credentials: %v", err)
	}

	log.Printf("Setup complete! API Key: %s, App ID: %s", result.APIKey, result.AppID)
}

func Example() {
	handler := &AppHandler{}

	config := client.ClientConfig{
		ServerURL:    "wss://your-worker.example.com/ws/app",
		APIKey:       os.Getenv("API_KEY"),
		AppName:      "MyPrintService",
		Capabilities: []string{"print", "scrape"},
		Handler:      handler,
	}

	signalingClient := client.NewSignalingClient(config)
	handler.signalingClient = signalingClient

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := signalingClient.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer signalingClient.Close()

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")
}
