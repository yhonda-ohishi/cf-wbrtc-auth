// E2E WebRTC tests for P2P connection functionality
//
// These tests validate the WebRTC implementation using local loopback connections.
// They test:
// - PeerConnection creation with default STUN servers
// - SDP offer/answer exchange
// - ICE candidate handling
// - DataChannel message exchange
// - Multiple message handling
// - Connection cleanup
//
// Run with: E2E_TEST=1 go test -v -run TestE2EWebRTC
//
// These tests do NOT require a live signaling server as they test the WebRTC
// stack in isolation using local loopback connections between two peers.

package client

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// webrtcTestHandler implements DataChannelHandler for testing
type webrtcTestHandler struct {
	mu           sync.Mutex
	messages     [][]byte
	opened       bool
	closed       bool
	messagesCond *sync.Cond
	openedCond   *sync.Cond
	closedCond   *sync.Cond
	t            *testing.T
}

func newWebRTCTestHandler(t *testing.T) *webrtcTestHandler {
	h := &webrtcTestHandler{
		messages: make([][]byte, 0),
		t:        t,
	}
	h.messagesCond = sync.NewCond(&h.mu)
	h.openedCond = sync.NewCond(&h.mu)
	h.closedCond = sync.NewCond(&h.mu)
	return h
}

func (h *webrtcTestHandler) OnMessage(data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.messages = append(h.messages, data)
	h.t.Logf("Received message: %s", string(data))
	h.messagesCond.Broadcast()
}

func (h *webrtcTestHandler) OnOpen() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.opened = true
	h.t.Log("DataChannel opened")
	h.openedCond.Broadcast()
}

func (h *webrtcTestHandler) OnClose() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	h.t.Log("DataChannel closed")
	h.closedCond.Broadcast()
}

func (h *webrtcTestHandler) waitForOpen(timeout time.Duration) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	deadline := time.Now().Add(timeout)
	for !h.opened {
		if time.Now().After(deadline) {
			return false
		}
		h.openedCond.Wait()
	}
	return true
}

func (h *webrtcTestHandler) waitForMessage(timeout time.Duration) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	deadline := time.Now().Add(timeout)
	initialCount := len(h.messages)
	for len(h.messages) == initialCount {
		if time.Now().After(deadline) {
			return false
		}
		h.messagesCond.Wait()
	}
	return true
}

func (h *webrtcTestHandler) getMessages() [][]byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	result := make([][]byte, len(h.messages))
	copy(result, h.messages)
	return result
}

func (h *webrtcTestHandler) isOpened() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.opened
}

func (h *webrtcTestHandler) isClosed() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.closed
}

// TestE2EWebRTCPeerConnectionCreation tests basic PeerConnection creation
func TestE2EWebRTCPeerConnectionCreation(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	handler := newWebRTCTestHandler(t)
	config := PeerConfig{
		Handler: handler,
		// Use default STUN servers
	}

	pc, err := NewPeerConnection(config)
	if err != nil {
		t.Fatalf("Failed to create peer connection: %v", err)
	}
	defer pc.Close()

	// Verify peer connection is created
	if pc == nil {
		t.Fatal("PeerConnection is nil")
	}

	// Verify initial state
	state := pc.ConnectionState()
	if state != webrtc.PeerConnectionStateNew {
		t.Errorf("Expected initial state to be New, got %v", state)
	}

	t.Log("Successfully created PeerConnection with default STUN servers")
}

// TestE2EWebRTCCreateOffer tests creating a local offer
func TestE2EWebRTCCreateOffer(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	handler := newWebRTCTestHandler(t)
	config := PeerConfig{
		Handler: handler,
	}

	pc, err := NewPeerConnection(config)
	if err != nil {
		t.Fatalf("Failed to create peer connection: %v", err)
	}
	defer pc.Close()

	// Create a data channel (required for offer creation)
	dc, err := pc.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}
	defer dc.Close()

	// Create offer
	offer, err := pc.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("Failed to create offer: %v", err)
	}

	// Verify offer SDP is not empty
	if offer.SDP == "" {
		t.Error("Offer SDP is empty")
	}

	// Verify offer type
	if offer.Type != webrtc.SDPTypeOffer {
		t.Errorf("Expected offer type to be Offer, got %v", offer.Type)
	}

	// Set local description
	err = pc.pc.SetLocalDescription(offer)
	if err != nil {
		t.Fatalf("Failed to set local description: %v", err)
	}

	t.Logf("Successfully created offer with %d bytes of SDP", len(offer.SDP))
}

// TestE2EWebRTCHandleOffer tests handling an incoming offer
func TestE2EWebRTCHandleOffer(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	// Create first peer to generate an offer
	offerHandler := newWebRTCTestHandler(t)
	offerPeer, err := NewPeerConnection(PeerConfig{Handler: offerHandler})
	if err != nil {
		t.Fatalf("Failed to create offer peer: %v", err)
	}
	defer offerPeer.Close()

	// Create data channel
	dc, err := offerPeer.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}
	defer dc.Close()

	// Create offer
	offer, err := offerPeer.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("Failed to create offer: %v", err)
	}

	err = offerPeer.pc.SetLocalDescription(offer)
	if err != nil {
		t.Fatalf("Failed to set local description on offer peer: %v", err)
	}

	// Create answer peer
	answerHandler := newWebRTCTestHandler(t)
	answerPeer, err := NewPeerConnection(PeerConfig{Handler: answerHandler})
	if err != nil {
		t.Fatalf("Failed to create answer peer: %v", err)
	}
	defer answerPeer.Close()

	// Test HandleOffer
	err = answerPeer.HandleOffer(offer.SDP, "test-request-123")
	if err != nil {
		t.Fatalf("Failed to handle offer: %v", err)
	}

	// Verify local description was set (answer was created)
	if answerPeer.pc.LocalDescription() == nil {
		t.Error("Local description not set after HandleOffer")
	}

	if answerPeer.pc.LocalDescription().Type != webrtc.SDPTypeAnswer {
		t.Errorf("Expected local description type to be Answer, got %v", answerPeer.pc.LocalDescription().Type)
	}

	t.Logf("Successfully handled offer and created answer")
}

// TestE2EWebRTCICECandidateHandling tests adding ICE candidates
func TestE2EWebRTCICECandidateHandling(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	handler := newWebRTCTestHandler(t)
	pc, err := NewPeerConnection(PeerConfig{Handler: handler})
	if err != nil {
		t.Fatalf("Failed to create peer connection: %v", err)
	}
	defer pc.Close()

	// Test adding ICE candidate before remote description (should queue it)
	testCandidate := json.RawMessage(`{
		"candidate": "candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host",
		"sdpMid": "0",
		"sdpMLineIndex": 0
	}`)

	err = pc.AddICECandidate(testCandidate)
	if err != nil {
		t.Errorf("Failed to add ICE candidate (should queue): %v", err)
	}

	// Verify candidate was queued
	pc.mu.Lock()
	queuedCount := len(pc.pendingICE)
	pc.mu.Unlock()

	if queuedCount != 1 {
		t.Errorf("Expected 1 queued ICE candidate, got %d", queuedCount)
	}

	t.Log("Successfully queued ICE candidate before remote description")
}

// TestE2EWebRTCLoopbackConnection tests a complete loopback P2P connection
func TestE2EWebRTCLoopbackConnection(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	// Create two peers for loopback connection
	offerHandler := newWebRTCTestHandler(t)
	answerHandler := newWebRTCTestHandler(t)

	offerPeer, err := NewPeerConnection(PeerConfig{Handler: offerHandler})
	if err != nil {
		t.Fatalf("Failed to create offer peer: %v", err)
	}
	defer offerPeer.Close()

	answerPeer, err := NewPeerConnection(PeerConfig{Handler: answerHandler})
	if err != nil {
		t.Fatalf("Failed to create answer peer: %v", err)
	}
	defer answerPeer.Close()

	// Track ICE candidates
	var offerICECandidates []webrtc.ICECandidateInit
	var answerICECandidates []webrtc.ICECandidateInit
	var offerICEMu sync.Mutex
	var answerICEMu sync.Mutex

	// Set up ICE candidate handlers
	offerPeer.pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		offerICEMu.Lock()
		offerICECandidates = append(offerICECandidates, candidate.ToJSON())
		offerICEMu.Unlock()

		// Add to answer peer
		go func() {
			candidateJSON, _ := json.Marshal(candidate.ToJSON())
			answerPeer.AddICECandidate(candidateJSON)
		}()
	})

	answerPeer.pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		answerICEMu.Lock()
		answerICECandidates = append(answerICECandidates, candidate.ToJSON())
		answerICEMu.Unlock()

		// Add to offer peer
		go func() {
			candidateJSON, _ := json.Marshal(candidate.ToJSON())
			offerPeer.AddICECandidate(candidateJSON)
		}()
	})

	// Create data channel on offer peer
	dc, err := offerPeer.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}

	// Set up data channel for offer peer
	offerPeer.mu.Lock()
	offerPeer.dataChannel = dc
	offerPeer.mu.Unlock()

	dc.OnOpen(func() {
		offerHandler.OnOpen()
	})
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		offerHandler.OnMessage(msg.Data)
	})

	// Create offer
	offer, err := offerPeer.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("Failed to create offer: %v", err)
	}

	err = offerPeer.pc.SetLocalDescription(offer)
	if err != nil {
		t.Fatalf("Failed to set offer local description: %v", err)
	}

	t.Log("Created and set offer")

	// Set remote description on answer peer
	err = answerPeer.pc.SetRemoteDescription(offer)
	if err != nil {
		t.Fatalf("Failed to set remote description on answer peer: %v", err)
	}

	// Create answer
	answer, err := answerPeer.pc.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("Failed to create answer: %v", err)
	}

	err = answerPeer.pc.SetLocalDescription(answer)
	if err != nil {
		t.Fatalf("Failed to set answer local description: %v", err)
	}

	t.Log("Created and set answer")

	// Set remote description on offer peer
	err = offerPeer.pc.SetRemoteDescription(answer)
	if err != nil {
		t.Fatalf("Failed to set remote description on offer peer: %v", err)
	}

	t.Log("Completed SDP exchange")

	// Wait for connection to establish
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	connected := false
	for {
		select {
		case <-ctx.Done():
			t.Fatal("Timeout waiting for connection to establish")
		case <-ticker.C:
			offerState := offerPeer.ConnectionState()
			answerState := answerPeer.ConnectionState()

			t.Logf("Offer state: %v, Answer state: %v", offerState, answerState)

			if offerState == webrtc.PeerConnectionStateConnected &&
				answerState == webrtc.PeerConnectionStateConnected {
				connected = true
				t.Log("Connection established!")
			}

			if offerState == webrtc.PeerConnectionStateFailed ||
				answerState == webrtc.PeerConnectionStateFailed {
				t.Fatal("Connection failed")
			}

			if connected {
				goto connectionEstablished
			}
		}
	}

connectionEstablished:
	// Wait for data channels to open
	if !offerHandler.waitForOpen(5 * time.Second) {
		t.Error("Offer peer data channel did not open")
	}
	if !answerHandler.waitForOpen(5 * time.Second) {
		t.Error("Answer peer data channel did not open")
	}

	// Verify both data channels are open
	if !offerHandler.isOpened() {
		t.Error("Offer handler did not receive OnOpen")
	}
	if !answerHandler.isOpened() {
		t.Error("Answer handler did not receive OnOpen")
	}

	t.Log("Data channels opened successfully")

	// Log ICE candidate counts
	offerICEMu.Lock()
	answerICEMu.Lock()
	t.Logf("Offer peer generated %d ICE candidates", len(offerICECandidates))
	t.Logf("Answer peer generated %d ICE candidates", len(answerICECandidates))
	offerICEMu.Unlock()
	answerICEMu.Unlock()

	t.Log("Loopback connection test passed")
}

// TestE2EWebRTCDataChannelMessaging tests message exchange over DataChannel
func TestE2EWebRTCDataChannelMessaging(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	// Create two peers
	offerHandler := newWebRTCTestHandler(t)
	answerHandler := newWebRTCTestHandler(t)

	offerPeer, err := NewPeerConnection(PeerConfig{Handler: offerHandler})
	if err != nil {
		t.Fatalf("Failed to create offer peer: %v", err)
	}
	defer offerPeer.Close()

	answerPeer, err := NewPeerConnection(PeerConfig{Handler: answerHandler})
	if err != nil {
		t.Fatalf("Failed to create answer peer: %v", err)
	}
	defer answerPeer.Close()

	// Set up ICE candidate exchange
	offerPeer.pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		go func() {
			candidateJSON, _ := json.Marshal(candidate.ToJSON())
			answerPeer.AddICECandidate(candidateJSON)
		}()
	})

	answerPeer.pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		go func() {
			candidateJSON, _ := json.Marshal(candidate.ToJSON())
			offerPeer.AddICECandidate(candidateJSON)
		}()
	})

	// Create data channel
	dc, err := offerPeer.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}

	offerPeer.mu.Lock()
	offerPeer.dataChannel = dc
	offerPeer.mu.Unlock()

	dc.OnOpen(func() {
		offerHandler.OnOpen()
	})
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		offerHandler.OnMessage(msg.Data)
	})

	// Create and exchange offers/answers
	offer, err := offerPeer.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("Failed to create offer: %v", err)
	}

	offerPeer.pc.SetLocalDescription(offer)
	answerPeer.pc.SetRemoteDescription(offer)

	answer, err := answerPeer.pc.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("Failed to create answer: %v", err)
	}

	answerPeer.pc.SetLocalDescription(answer)
	offerPeer.pc.SetRemoteDescription(answer)

	// Wait for connection
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			t.Fatal("Timeout waiting for connection")
		case <-ticker.C:
			if offerPeer.ConnectionState() == webrtc.PeerConnectionStateConnected &&
				answerPeer.ConnectionState() == webrtc.PeerConnectionStateConnected {
				goto connected
			}
		}
	}

connected:
	// Wait for data channels to open
	if !offerHandler.waitForOpen(5 * time.Second) {
		t.Fatal("Offer data channel did not open")
	}
	if !answerHandler.waitForOpen(5 * time.Second) {
		t.Fatal("Answer data channel did not open")
	}

	t.Log("Connection established, testing message exchange")

	// Send message from offer to answer peer
	testMessage1 := []byte("Hello from offer peer!")
	err = offerPeer.Send(testMessage1)
	if err != nil {
		t.Fatalf("Failed to send message from offer peer: %v", err)
	}

	// Wait for message on answer peer
	if !answerHandler.waitForMessage(5 * time.Second) {
		t.Fatal("Answer peer did not receive message")
	}

	answerMessages := answerHandler.getMessages()
	if len(answerMessages) < 1 {
		t.Fatal("Answer peer received no messages")
	}

	if string(answerMessages[0]) != string(testMessage1) {
		t.Errorf("Message mismatch. Expected '%s', got '%s'", testMessage1, answerMessages[0])
	}

	t.Log("Successfully sent message from offer to answer peer")

	// Send message from answer to offer peer
	testMessage2 := []byte("Hello from answer peer!")
	err = answerPeer.Send(testMessage2)
	if err != nil {
		t.Fatalf("Failed to send message from answer peer: %v", err)
	}

	// Wait for message on offer peer
	if !offerHandler.waitForMessage(5 * time.Second) {
		t.Fatal("Offer peer did not receive message")
	}

	offerMessages := offerHandler.getMessages()
	if len(offerMessages) < 1 {
		t.Fatal("Offer peer received no messages")
	}

	if string(offerMessages[0]) != string(testMessage2) {
		t.Errorf("Message mismatch. Expected '%s', got '%s'", testMessage2, offerMessages[0])
	}

	t.Log("Successfully sent message from answer to offer peer")

	// Test SendText
	testTextMessage := "This is a text message!"
	err = offerPeer.SendText(testTextMessage)
	if err != nil {
		t.Fatalf("Failed to send text message: %v", err)
	}

	if !answerHandler.waitForMessage(5 * time.Second) {
		t.Fatal("Answer peer did not receive text message")
	}

	answerMessages = answerHandler.getMessages()
	if len(answerMessages) < 2 {
		t.Fatal("Answer peer did not receive second message")
	}

	if string(answerMessages[1]) != testTextMessage {
		t.Errorf("Text message mismatch. Expected '%s', got '%s'", testTextMessage, answerMessages[1])
	}

	t.Log("Data channel messaging test passed")
}

// TestE2EWebRTCMultipleMessages tests sending multiple messages
func TestE2EWebRTCMultipleMessages(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	// Create and connect peers (simplified version of previous test)
	offerHandler := newWebRTCTestHandler(t)
	answerHandler := newWebRTCTestHandler(t)

	offerPeer, _ := NewPeerConnection(PeerConfig{Handler: offerHandler})
	defer offerPeer.Close()

	answerPeer, _ := NewPeerConnection(PeerConfig{Handler: answerHandler})
	defer answerPeer.Close()

	// ICE exchange
	offerPeer.pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			candidateJSON, _ := json.Marshal(c.ToJSON())
			answerPeer.AddICECandidate(candidateJSON)
		}
	})
	answerPeer.pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			candidateJSON, _ := json.Marshal(c.ToJSON())
			offerPeer.AddICECandidate(candidateJSON)
		}
	})

	// Create data channel
	dc, _ := offerPeer.pc.CreateDataChannel("test", nil)
	offerPeer.mu.Lock()
	offerPeer.dataChannel = dc
	offerPeer.mu.Unlock()
	dc.OnOpen(func() { offerHandler.OnOpen() })
	dc.OnMessage(func(msg webrtc.DataChannelMessage) { offerHandler.OnMessage(msg.Data) })

	// SDP exchange
	offer, _ := offerPeer.pc.CreateOffer(nil)
	offerPeer.pc.SetLocalDescription(offer)
	answerPeer.pc.SetRemoteDescription(offer)
	answer, _ := answerPeer.pc.CreateAnswer(nil)
	answerPeer.pc.SetLocalDescription(answer)
	offerPeer.pc.SetRemoteDescription(answer)

	// Wait for connection
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			t.Fatal("Connection timeout")
		case <-ticker.C:
			if offerPeer.ConnectionState() == webrtc.PeerConnectionStateConnected {
				goto connected
			}
		}
	}

connected:
	offerHandler.waitForOpen(5 * time.Second)
	answerHandler.waitForOpen(5 * time.Second)

	// Send multiple messages
	messageCount := 10
	for i := 0; i < messageCount; i++ {
		msg := []byte(string(rune('A' + i)))
		err := offerPeer.Send(msg)
		if err != nil {
			t.Fatalf("Failed to send message %d: %v", i, err)
		}
		time.Sleep(10 * time.Millisecond) // Small delay between messages
	}

	// Wait for all messages
	time.Sleep(2 * time.Second)

	receivedMessages := answerHandler.getMessages()
	if len(receivedMessages) != messageCount {
		t.Errorf("Expected %d messages, received %d", messageCount, len(receivedMessages))
	}

	// Verify message order and content
	for i := 0; i < len(receivedMessages) && i < messageCount; i++ {
		expected := string(rune('A' + i))
		if string(receivedMessages[i]) != expected {
			t.Errorf("Message %d mismatch. Expected '%s', got '%s'", i, expected, receivedMessages[i])
		}
	}

	t.Logf("Successfully sent and received %d messages in order", len(receivedMessages))
}

// TestE2EWebRTCConnectionClosure tests proper connection cleanup
func TestE2EWebRTCConnectionClosure(t *testing.T) {
	_, _, runE2E := getE2EConfig()
	if !runE2E {
		t.Skip("E2E tests disabled. Set E2E_TEST=1 to run")
	}

	handler := newWebRTCTestHandler(t)
	pc, err := NewPeerConnection(PeerConfig{Handler: handler})
	if err != nil {
		t.Fatalf("Failed to create peer connection: %v", err)
	}

	// Create data channel
	dc, err := pc.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}

	pc.mu.Lock()
	pc.dataChannel = dc
	pc.mu.Unlock()

	// Close connection
	err = pc.Close()
	if err != nil {
		t.Errorf("Failed to close peer connection: %v", err)
	}

	// Verify state
	state := pc.ConnectionState()
	if state != webrtc.PeerConnectionStateClosed {
		t.Errorf("Expected state Closed after Close(), got %v", state)
	}

	// Verify data channel is nil
	pc.mu.RLock()
	dcNil := pc.dataChannel == nil
	pc.mu.RUnlock()

	if !dcNil {
		t.Error("Data channel should be nil after Close()")
	}

	t.Log("Connection closure test passed")
}
