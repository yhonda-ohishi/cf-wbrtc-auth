package reflection

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
)

// mockRegistry is a mock implementation of HandlerRegistry for testing
type mockRegistry struct {
	methods []string
}

func (m *mockRegistry) GetRegisteredMethods() []string {
	return m.methods
}

func TestListServicesEmpty(t *testing.T) {
	registry := &mockRegistry{methods: []string{}}
	r := New(registry)

	resp := r.ListServices()

	if len(resp.Services) != 0 {
		t.Errorf("Expected 0 services, got %d", len(resp.Services))
	}
}

func TestListServicesSingleService(t *testing.T) {
	registry := &mockRegistry{
		methods: []string{
			"/mypackage.MyService/GetUser",
			"/mypackage.MyService/UpdateUser",
			"/mypackage.MyService/DeleteUser",
		},
	}
	r := New(registry)

	resp := r.ListServices()

	if len(resp.Services) != 1 {
		t.Fatalf("Expected 1 service, got %d", len(resp.Services))
	}

	svc := resp.Services[0]
	if svc.Name != "mypackage.MyService" {
		t.Errorf("Expected service name 'mypackage.MyService', got '%s'", svc.Name)
	}

	if len(svc.Methods) != 3 {
		t.Fatalf("Expected 3 methods, got %d", len(svc.Methods))
	}

	// Methods should be sorted
	expectedMethods := []string{"DeleteUser", "GetUser", "UpdateUser"}
	for i, expected := range expectedMethods {
		if svc.Methods[i] != expected {
			t.Errorf("Expected method[%d] = '%s', got '%s'", i, expected, svc.Methods[i])
		}
	}
}

func TestListServicesMultipleServices(t *testing.T) {
	registry := &mockRegistry{
		methods: []string{
			"/users.UserService/GetUser",
			"/orders.OrderService/CreateOrder",
			"/users.UserService/UpdateUser",
			"/orders.OrderService/GetOrder",
		},
	}
	r := New(registry)

	resp := r.ListServices()

	if len(resp.Services) != 2 {
		t.Fatalf("Expected 2 services, got %d", len(resp.Services))
	}

	// Services should be sorted by name
	if resp.Services[0].Name != "orders.OrderService" {
		t.Errorf("Expected first service 'orders.OrderService', got '%s'", resp.Services[0].Name)
	}
	if resp.Services[1].Name != "users.UserService" {
		t.Errorf("Expected second service 'users.UserService', got '%s'", resp.Services[1].Name)
	}

	// Check methods
	if len(resp.Services[0].Methods) != 2 {
		t.Errorf("Expected 2 methods for OrderService, got %d", len(resp.Services[0].Methods))
	}
	if len(resp.Services[1].Methods) != 2 {
		t.Errorf("Expected 2 methods for UserService, got %d", len(resp.Services[1].Methods))
	}
}

func TestListServicesExcludesReflection(t *testing.T) {
	registry := &mockRegistry{
		methods: []string{
			"/mypackage.MyService/GetUser",
			"/grpc.reflection.v1alpha.ServerReflection/ListServices",
			"/grpc.reflection.v1alpha.ServerReflection/GetFileByName",
		},
	}
	r := New(registry)

	resp := r.ListServices()

	// Should only include MyService, not reflection
	if len(resp.Services) != 1 {
		t.Fatalf("Expected 1 service (excluding reflection), got %d", len(resp.Services))
	}

	if resp.Services[0].Name != "mypackage.MyService" {
		t.Errorf("Expected 'mypackage.MyService', got '%s'", resp.Services[0].Name)
	}
}

func TestHandler(t *testing.T) {
	registry := &mockRegistry{
		methods: []string{
			"/test.TestService/TestMethod",
		},
	}
	r := New(registry)
	handler := r.Handler()

	req := &codec.RequestEnvelope{
		Path:    MethodPath,
		Headers: map[string]string{},
		Message: []byte{},
	}

	resp, err := handler(context.Background(), req)
	if err != nil {
		t.Fatalf("Handler returned error: %v", err)
	}

	if resp.Headers["content-type"] != "application/json" {
		t.Errorf("Expected content-type 'application/json', got '%s'", resp.Headers["content-type"])
	}

	if resp.Trailers["grpc-status"] != "0" {
		t.Errorf("Expected grpc-status '0', got '%s'", resp.Trailers["grpc-status"])
	}

	if len(resp.Messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(resp.Messages))
	}

	// Parse JSON response
	var listResp ListServicesResponse
	err = json.Unmarshal(resp.Messages[0], &listResp)
	if err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if len(listResp.Services) != 1 {
		t.Errorf("Expected 1 service in JSON response, got %d", len(listResp.Services))
	}
}

func TestEncodeListServicesResponse(t *testing.T) {
	resp := &ListServicesResponse{
		Services: []ServiceInfo{
			{Name: "test.Service", Methods: []string{"MethodA", "MethodB"}},
		},
	}

	data := encodeListServicesResponse(resp)

	// Verify it's valid JSON
	var decoded ListServicesResponse
	err := json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("encodeListServicesResponse produced invalid JSON: %v", err)
	}

	if len(decoded.Services) != 1 {
		t.Errorf("Expected 1 service, got %d", len(decoded.Services))
	}
	if decoded.Services[0].Name != "test.Service" {
		t.Errorf("Expected 'test.Service', got '%s'", decoded.Services[0].Name)
	}
	if len(decoded.Services[0].Methods) != 2 {
		t.Errorf("Expected 2 methods, got %d", len(decoded.Services[0].Methods))
	}
}

func TestEscapeJSON(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", "simple"},
		{`with"quote`, `with\"quote`},
		{"with\\backslash", "with\\\\backslash"},
		{"with\nnewline", "with\\nnewline"},
		{"with\ttab", "with\\ttab"},
		{"with\rcarriage", "with\\rcarriage"},
	}

	for _, tt := range tests {
		result := escapeJSON(tt.input)
		if result != tt.expected {
			t.Errorf("escapeJSON(%q) = %q, expected %q", tt.input, result, tt.expected)
		}
	}
}
