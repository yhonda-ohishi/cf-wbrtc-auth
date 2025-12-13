package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Mock handler for testing
type mockHandler struct {
	mu              sync.Mutex
	authenticated   bool
	authError       string
	appRegistered   bool
	appID           string
	offers          []string
	iceReceived     int
	errors          []string
	connected       bool
	disconnected    bool
}

func (h *mockHandler) OnAuthenticated(payload AuthOKPayload) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.authenticated = true
}

func (h *mockHandler) OnAuthError(payload AuthErrorPayload) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.authError = payload.Error
}

func (h *mockHandler) OnAppRegistered(payload AppRegisteredPayload) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.appRegistered = true
	h.appID = payload.AppID
}

func (h *mockHandler) OnOffer(sdp string, requestID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.offers = append(h.offers, sdp)
}

func (h *mockHandler) OnAnswer(sdp string, appID string) {}

func (h *mockHandler) OnICE(candidate json.RawMessage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.iceReceived++
}

func (h *mockHandler) OnError(message string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.errors = append(h.errors, message)
}

func (h *mockHandler) OnConnected() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connected = true
}

func (h *mockHandler) OnDisconnected() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.disconnected = true
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func TestSignalingClientConnect(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("Failed to upgrade: %v", err)
			return
		}
		defer conn.Close()

		// Read auth message
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var wsMsg WSMessage
		json.Unmarshal(msg, &wsMsg)

		if wsMsg.Type == MsgTypeAuth {
			// Send auth_ok
			response := WSMessage{
				Type:    MsgTypeAuthOK,
				Payload: json.RawMessage(`{"userId":"test-user","type":"app"}`),
			}
			respBytes, _ := json.Marshal(response)
			conn.WriteMessage(websocket.TextMessage, respBytes)

			// Read app_register
			_, msg, err = conn.ReadMessage()
			if err != nil {
				return
			}
			json.Unmarshal(msg, &wsMsg)

			if wsMsg.Type == MsgTypeAppRegister {
				// Send app_registered
				response := WSMessage{
					Type:    MsgTypeAppRegistered,
					Payload: json.RawMessage(`{"appId":"test-app-id"}`),
				}
				respBytes, _ := json.Marshal(response)
				conn.WriteMessage(websocket.TextMessage, respBytes)
			}
		}

		// Keep connection open
		time.Sleep(100 * time.Millisecond)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	handler := &mockHandler{}
	config := ClientConfig{
		ServerURL:    wsURL,
		APIKey:       "test-api-key",
		AppName:      "TestApp",
		Capabilities: []string{"test"},
		Handler:      handler,
		PingInterval: 10 * time.Second,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	// Wait for messages to be processed
	time.Sleep(50 * time.Millisecond)

	handler.mu.Lock()
	defer handler.mu.Unlock()

	if !handler.connected {
		t.Error("OnConnected was not called")
	}

	if !handler.authenticated {
		t.Error("OnAuthenticated was not called")
	}

	if !handler.appRegistered {
		t.Error("OnAppRegistered was not called")
	}

	if handler.appID != "test-app-id" {
		t.Errorf("Expected appID 'test-app-id', got '%s'", handler.appID)
	}
}

func TestSignalingClientAuthError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Read auth message
		_, _, err = conn.ReadMessage()
		if err != nil {
			return
		}

		// Send auth_error
		response := WSMessage{
			Type:    MsgTypeAuthError,
			Payload: json.RawMessage(`{"error":"Invalid API key"}`),
		}
		respBytes, _ := json.Marshal(response)
		conn.WriteMessage(websocket.TextMessage, respBytes)

		time.Sleep(50 * time.Millisecond)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	handler := &mockHandler{}
	config := ClientConfig{
		ServerURL: wsURL,
		APIKey:    "invalid-key",
		Handler:   handler,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client.Connect(ctx)
	defer client.Close()

	time.Sleep(50 * time.Millisecond)

	handler.mu.Lock()
	defer handler.mu.Unlock()

	if handler.authError != "Invalid API key" {
		t.Errorf("Expected auth error 'Invalid API key', got '%s'", handler.authError)
	}
}

func TestSignalingClientReceiveOffer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Read auth message
		conn.ReadMessage()

		// Send auth_ok
		authResp := WSMessage{
			Type:    MsgTypeAuthOK,
			Payload: json.RawMessage(`{"userId":"test-user","type":"app"}`),
		}
		respBytes, _ := json.Marshal(authResp)
		conn.WriteMessage(websocket.TextMessage, respBytes)

		// Read app_register
		conn.ReadMessage()

		// Send offer
		offerResp := WSMessage{
			Type:      MsgTypeOffer,
			Payload:   json.RawMessage(`{"sdp":"v=0\r\n..."}`),
			RequestID: "req-123",
		}
		respBytes, _ = json.Marshal(offerResp)
		conn.WriteMessage(websocket.TextMessage, respBytes)

		time.Sleep(100 * time.Millisecond)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	handler := &mockHandler{}
	config := ClientConfig{
		ServerURL: wsURL,
		APIKey:    "test-key",
		Handler:   handler,
	}

	client := NewSignalingClient(config)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client.Connect(ctx)
	defer client.Close()

	time.Sleep(100 * time.Millisecond)

	handler.mu.Lock()
	defer handler.mu.Unlock()

	if len(handler.offers) != 1 {
		t.Errorf("Expected 1 offer, got %d", len(handler.offers))
	}

	if len(handler.offers) > 0 && handler.offers[0] != "v=0\r\n..." {
		t.Errorf("Unexpected SDP: %s", handler.offers[0])
	}
}

func TestMessageTypes(t *testing.T) {
	tests := []struct {
		name     string
		msgType  string
		expected string
	}{
		{"Auth", MsgTypeAuth, "auth"},
		{"AuthOK", MsgTypeAuthOK, "auth_ok"},
		{"AuthError", MsgTypeAuthError, "auth_error"},
		{"AppRegister", MsgTypeAppRegister, "app_register"},
		{"AppRegistered", MsgTypeAppRegistered, "app_registered"},
		{"Offer", MsgTypeOffer, "offer"},
		{"Answer", MsgTypeAnswer, "answer"},
		{"ICE", MsgTypeICE, "ice"},
		{"Error", MsgTypeError, "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.msgType != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, tt.msgType)
			}
		})
	}
}
