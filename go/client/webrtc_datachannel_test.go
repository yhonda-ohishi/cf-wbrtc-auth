package client

import (
	"testing"
)

// TestDataChannelGetter tests the DataChannel() getter method
func TestDataChannelGetter(t *testing.T) {
	// Create a peer connection
	pc, err := NewPeerConnection(PeerConfig{
		Handler: nil,
	})
	if err != nil {
		t.Fatalf("Failed to create peer connection: %v", err)
	}
	defer pc.Close()

	// Initially, data channel should be nil
	dc := pc.DataChannel()
	if dc != nil {
		t.Error("Expected DataChannel to be nil initially")
	}

	// Create a data channel (simulating browser-initiated connection)
	testDC, err := pc.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}

	// Manually set the data channel (normally set via OnDataChannel callback)
	pc.mu.Lock()
	pc.dataChannel = testDC
	pc.mu.Unlock()

	// Now DataChannel() should return the channel
	dc = pc.DataChannel()
	if dc == nil {
		t.Error("Expected DataChannel to be non-nil after setting")
	}

	if dc != testDC {
		t.Error("DataChannel() returned different channel than expected")
	}

	// After closing, verify state
	err = pc.Close()
	if err != nil {
		t.Errorf("Failed to close peer connection: %v", err)
	}

	// DataChannel should be nil after close
	dc = pc.DataChannel()
	if dc != nil {
		t.Error("Expected DataChannel to be nil after Close()")
	}
}

// TestDataChannelGetterThreadSafety tests concurrent access to DataChannel
func TestDataChannelGetterThreadSafety(t *testing.T) {
	pc, err := NewPeerConnection(PeerConfig{
		Handler: nil,
	})
	if err != nil {
		t.Fatalf("Failed to create peer connection: %v", err)
	}
	defer pc.Close()

	// Create a data channel
	testDC, err := pc.pc.CreateDataChannel("test", nil)
	if err != nil {
		t.Fatalf("Failed to create data channel: %v", err)
	}

	done := make(chan bool)

	// Goroutine 1: Set the data channel
	go func() {
		pc.mu.Lock()
		pc.dataChannel = testDC
		pc.mu.Unlock()
		done <- true
	}()

	// Goroutine 2: Read the data channel
	go func() {
		for i := 0; i < 100; i++ {
			_ = pc.DataChannel()
		}
		done <- true
	}()

	// Goroutine 3: Read the data channel
	go func() {
		for i := 0; i < 100; i++ {
			_ = pc.DataChannel()
		}
		done <- true
	}()

	// Wait for all goroutines to complete
	<-done
	<-done
	<-done

	t.Log("Thread safety test completed without race conditions")
}
