package transport

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
	"github.com/pion/webrtc/v4"
)

// mockDataChannel is a mock implementation of DataChannelInterface for testing
type mockDataChannel struct {
	onMessage    func(msg webrtc.DataChannelMessage)
	onClose      func()
	onError      func(err error)
	sentMessages [][]byte
	closed       bool
}

func newMockDataChannel() *mockDataChannel {
	return &mockDataChannel{
		sentMessages: make([][]byte, 0),
	}
}

func (m *mockDataChannel) Send(data []byte) error {
	m.sentMessages = append(m.sentMessages, data)
	return nil
}

func (m *mockDataChannel) Close() error {
	m.closed = true
	if m.onClose != nil {
		m.onClose()
	}
	return nil
}

func (m *mockDataChannel) OnMessage(handler func(msg webrtc.DataChannelMessage)) {
	m.onMessage = handler
}

func (m *mockDataChannel) OnClose(handler func()) {
	m.onClose = handler
}

func (m *mockDataChannel) OnError(handler func(err error)) {
	m.onError = handler
}

func (m *mockDataChannel) simulateMessage(data []byte) {
	if m.onMessage != nil {
		m.onMessage(webrtc.DataChannelMessage{Data: data})
	}
}

func TestNewDataChannelTransport(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	if transport == nil {
		t.Fatal("Expected non-nil transport")
	}

	if transport.dc != dc {
		t.Error("Transport should reference the data channel")
	}

	if transport.options.Timeout != 30*time.Second {
		t.Errorf("Expected default timeout 30s, got %v", transport.options.Timeout)
	}
}

func TestRegisterHandler(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	handler := func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		return &codec.ResponseEnvelope{}, nil
	}

	transport.RegisterHandler("/test.Service/Method", handler)

	if _, ok := transport.handlers["/test.Service/Method"]; !ok {
		t.Error("Handler not registered")
	}
}

func TestUnregisterHandler(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	handler := func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		return &codec.ResponseEnvelope{}, nil
	}

	transport.RegisterHandler("/test.Service/Method", handler)
	transport.UnregisterHandler("/test.Service/Method")

	if _, ok := transport.handlers["/test.Service/Method"]; ok {
		t.Error("Handler should be unregistered")
	}
}

func TestMakeHandler(t *testing.T) {
	// Define test types
	type TestRequest struct {
		Value string
	}
	type TestResponse struct {
		Result string
	}

	// Create a typed handler
	handler := MakeHandler(
		func(data []byte) (*TestRequest, error) {
			return &TestRequest{Value: string(data)}, nil
		},
		func(resp *TestResponse) ([]byte, error) {
			return []byte(resp.Result), nil
		},
		func(ctx context.Context, req *TestRequest) (*TestResponse, error) {
			return &TestResponse{Result: "processed:" + req.Value}, nil
		},
	)

	// Create request envelope
	reqEnv := &codec.RequestEnvelope{
		Path:    "/test.Service/Method",
		Headers: map[string]string{},
		Message: []byte("test-data"),
	}

	// Call handler
	respEnv, err := handler(context.Background(), reqEnv)
	if err != nil {
		t.Fatalf("Handler returned error: %v", err)
	}

	// Verify response
	if len(respEnv.Messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(respEnv.Messages))
	}

	if string(respEnv.Messages[0]) != "processed:test-data" {
		t.Errorf("Expected 'processed:test-data', got '%s'", string(respEnv.Messages[0]))
	}

	if respEnv.Trailers["grpc-status"] != "0" {
		t.Errorf("Expected grpc-status=0, got %s", respEnv.Trailers["grpc-status"])
	}
}

func TestMakeHandlerError(t *testing.T) {
	type TestRequest struct{}
	type TestResponse struct{}

	// Handler that returns an error
	handler := MakeHandler(
		func(data []byte) (*TestRequest, error) {
			return &TestRequest{}, nil
		},
		func(resp *TestResponse) ([]byte, error) {
			return []byte{}, nil
		},
		func(ctx context.Context, req *TestRequest) (*TestResponse, error) {
			return nil, &codec.GRPCError{
				Code:    codec.StatusInvalidArgument,
				Message: "test error",
			}
		},
	)

	reqEnv := &codec.RequestEnvelope{
		Path:    "/test.Service/Method",
		Headers: map[string]string{},
		Message: []byte{},
	}

	_, err := handler(context.Background(), reqEnv)
	if err == nil {
		t.Fatal("Expected error, got nil")
	}

	grpcErr, ok := err.(*codec.GRPCError)
	if !ok {
		t.Fatalf("Expected GRPCError, got %T", err)
	}

	if grpcErr.Code != codec.StatusInvalidArgument {
		t.Errorf("Expected code %d, got %d", codec.StatusInvalidArgument, grpcErr.Code)
	}

	if grpcErr.Message != "test error" {
		t.Errorf("Expected 'test error', got '%s'", grpcErr.Message)
	}
}

func TestOnClose(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	called := false
	transport.OnClose(func() {
		called = true
	})

	transport.Start()
	transport.Close()

	if !called {
		t.Error("OnClose callback not called")
	}

	if !dc.closed {
		t.Error("DataChannel not closed")
	}
}

func TestCustomTimeout(t *testing.T) {
	dc := newMockDataChannel()
	opts := &HandlerOptions{
		Timeout: 5 * time.Second,
	}
	transport := newDataChannelTransportWithInterface(dc, opts)

	if transport.options.Timeout != 5*time.Second {
		t.Errorf("Expected timeout 5s, got %v", transport.options.Timeout)
	}
}

func TestSendResponseAfterClose(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	transport.Close()

	envelope := &codec.ResponseEnvelope{
		Headers:  map[string]string{},
		Messages: [][]byte{[]byte("test")},
		Trailers: map[string]string{"grpc-status": "0"},
	}

	err := transport.SendResponse(envelope)
	if err == nil {
		t.Error("Expected error when sending after close")
	}
}

func TestRequestIDEcho(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	// Register a simple handler
	transport.RegisterHandler("/test.Service/Method", func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		return &codec.ResponseEnvelope{
			Headers:  map[string]string{},
			Messages: [][]byte{[]byte("response")},
			Trailers: map[string]string{"grpc-status": strconv.Itoa(codec.StatusOK)},
		}, nil
	})

	transport.Start()

	// Create request with x-request-id
	reqEnv := codec.RequestEnvelope{
		Path:    "/test.Service/Method",
		Headers: map[string]string{"x-request-id": "test-123"},
		Message: []byte("test"),
	}

	reqData, err := codec.EncodeRequest(reqEnv)
	if err != nil {
		t.Fatalf("Failed to encode request: %v", err)
	}

	// Simulate receiving the request
	dc.simulateMessage(reqData)

	// Give it time to process
	time.Sleep(10 * time.Millisecond)

	// Check that a response was sent
	if len(dc.sentMessages) == 0 {
		t.Fatal("No response sent")
	}

	// Decode the response
	respData := dc.sentMessages[0]
	respEnv, err := codec.DecodeResponse(respData)
	if err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify x-request-id was echoed
	if respEnv.Headers["x-request-id"] != "test-123" {
		t.Errorf("Expected x-request-id 'test-123', got '%s'", respEnv.Headers["x-request-id"])
	}
}

func TestUnimplementedMethod(t *testing.T) {
	dc := newMockDataChannel()
	transport := newDataChannelTransportWithInterface(dc, nil)

	transport.Start()

	// Create request for unregistered method
	reqEnv := codec.RequestEnvelope{
		Path:    "/unknown.Service/Method",
		Headers: map[string]string{},
		Message: []byte("test"),
	}

	reqData, err := codec.EncodeRequest(reqEnv)
	if err != nil {
		t.Fatalf("Failed to encode request: %v", err)
	}

	// Simulate receiving the request
	dc.simulateMessage(reqData)

	// Give it time to process
	time.Sleep(10 * time.Millisecond)

	// Check that an error response was sent
	if len(dc.sentMessages) == 0 {
		t.Fatal("No response sent")
	}

	// Decode the response
	respData := dc.sentMessages[0]
	respEnv, err := codec.DecodeResponse(respData)
	if err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify it's an UNIMPLEMENTED error
	grpcErr := codec.GetError(*respEnv)
	if grpcErr == nil {
		t.Fatal("Expected error response")
	}

	if grpcErr.Code != codec.StatusUnimplemented {
		t.Errorf("Expected UNIMPLEMENTED status, got %d", grpcErr.Code)
	}
}
