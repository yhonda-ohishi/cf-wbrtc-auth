package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSetupPolling(t *testing.T) {
	pollCount := 0
	token := "test-token-12345"

	// Create mock server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup/init":
			if r.Method != "POST" {
				t.Errorf("Expected POST method, got %s", r.Method)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"token":"%s","url":"http://example.com/setup/%s"}`, token, token)

		case "/setup/poll":
			if r.Method != "GET" {
				t.Errorf("Expected GET method, got %s", r.Method)
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			reqToken := r.URL.Query().Get("token")
			if reqToken != token {
				t.Errorf("Expected token %s, got %s", token, reqToken)
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			pollCount++
			// Return pending for first 2 polls, then complete
			if pollCount < 3 {
				fmt.Fprintf(w, `{"status":"pending"}`)
			} else {
				fmt.Fprintf(w, `{"status":"complete","apiKey":"test-api-key","appId":"test-app-id"}`)
			}

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	config := SetupConfig{
		ServerURL:    mockServer.URL,
		PollInterval: 10 * time.Millisecond,
		Timeout:      1 * time.Second,
	}

	ctx := context.Background()

	result, err := Setup(ctx, config)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	if result.APIKey != "test-api-key" {
		t.Errorf("APIKey mismatch: got %s, want test-api-key", result.APIKey)
	}

	if result.AppID != "test-app-id" {
		t.Errorf("AppID mismatch: got %s, want test-app-id", result.AppID)
	}

	if pollCount < 3 {
		t.Errorf("Expected at least 3 polls, got %d", pollCount)
	}
}

func TestSetupTimeout(t *testing.T) {
	// Create mock server that always returns pending
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup/init":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"token":"test-token","url":"http://example.com/setup/test-token"}`)

		case "/setup/poll":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"status":"pending"}`)

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	config := SetupConfig{
		ServerURL:    mockServer.URL,
		PollInterval: 10 * time.Millisecond,
		Timeout:      50 * time.Millisecond,
	}

	ctx := context.Background()

	_, err := Setup(ctx, config)
	if err == nil {
		t.Error("Expected timeout error")
	}
}

func TestSetupContextCancel(t *testing.T) {
	// Create mock server that always returns pending
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup/init":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"token":"test-token","url":"http://example.com/setup/test-token"}`)

		case "/setup/poll":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"status":"pending"}`)

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	config := SetupConfig{
		ServerURL:    mockServer.URL,
		PollInterval: 10 * time.Millisecond,
		Timeout:      10 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Cancel context after 50ms
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, err := Setup(ctx, config)
	if err == nil {
		t.Error("Expected cancellation error")
	}
}

func TestSaveAndLoadCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	credPath := filepath.Join(tmpDir, "credentials.env")

	// Save credentials
	original := &SetupResult{
		APIKey: "test-api-key-12345",
		AppID:  "test-app-id-67890",
	}

	err := SaveCredentials(credPath, original)
	if err != nil {
		t.Fatalf("SaveCredentials failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(credPath); os.IsNotExist(err) {
		t.Fatal("Credentials file was not created")
	}

	// Load credentials
	loaded, err := LoadCredentials(credPath)
	if err != nil {
		t.Fatalf("LoadCredentials failed: %v", err)
	}

	if loaded.APIKey != original.APIKey {
		t.Errorf("APIKey mismatch: got %s, want %s", loaded.APIKey, original.APIKey)
	}

	if loaded.AppID != original.AppID {
		t.Errorf("AppID mismatch: got %s, want %s", loaded.AppID, original.AppID)
	}
}

func TestLoadCredentialsMissingFile(t *testing.T) {
	_, err := LoadCredentials("/nonexistent/path/credentials.env")
	if err == nil {
		t.Error("Expected error for missing file")
	}
}

func TestLoadCredentialsMissingAPIKey(t *testing.T) {
	tmpDir := t.TempDir()
	credPath := filepath.Join(tmpDir, "credentials.env")

	// Write file without API_KEY
	err := os.WriteFile(credPath, []byte("APP_ID=test\n"), 0600)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err = LoadCredentials(credPath)
	if err == nil {
		t.Error("Expected error for missing API_KEY")
	}
}

func TestSplitLines(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"a\nb\nc", []string{"a", "b", "c"}},
		{"a\r\nb\r\nc", []string{"a", "b", "c"}},
		{"single", []string{"single"}},
		{"", []string{}},
		{"a\n", []string{"a"}},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("input=%q", tt.input), func(t *testing.T) {
			result := splitLines(tt.input)
			if len(result) != len(tt.expected) {
				t.Errorf("Length mismatch: got %d, want %d", len(result), len(tt.expected))
				return
			}
			for i, v := range result {
				if v != tt.expected[i] {
					t.Errorf("Index %d: got %q, want %q", i, v, tt.expected[i])
				}
			}
		})
	}
}

func TestParseKeyValue(t *testing.T) {
	tests := []struct {
		input   string
		wantKey string
		wantVal string
	}{
		{"KEY=value", "KEY", "value"},
		{"KEY=", "KEY", ""},
		{"KEY=val=ue", "KEY", "val=ue"},
		{"NOEQUALS", "NOEQUALS", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			key, val := parseKeyValue(tt.input)
			if key != tt.wantKey {
				t.Errorf("Key: got %q, want %q", key, tt.wantKey)
			}
			if val != tt.wantVal {
				t.Errorf("Value: got %q, want %q", val, tt.wantVal)
			}
		})
	}
}

func TestSetupPollingWithRefreshToken(t *testing.T) {
	pollCount := 0
	token := "test-token-12345"

	// Create mock server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup/init":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"token":"%s","url":"http://example.com/setup/%s"}`, token, token)

		case "/setup/poll":
			w.Header().Set("Content-Type", "application/json")
			pollCount++
			if pollCount < 2 {
				fmt.Fprintf(w, `{"status":"pending"}`)
			} else {
				fmt.Fprintf(w, `{"status":"complete","apiKey":"test-api-key","appId":"test-app-id","refreshToken":"rt_test-refresh-token"}`)
			}

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	config := SetupConfig{
		ServerURL:    mockServer.URL,
		PollInterval: 10 * time.Millisecond,
		Timeout:      1 * time.Second,
	}

	ctx := context.Background()
	result, err := Setup(ctx, config)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	if result.APIKey != "test-api-key" {
		t.Errorf("APIKey mismatch: got %s, want test-api-key", result.APIKey)
	}

	if result.AppID != "test-app-id" {
		t.Errorf("AppID mismatch: got %s, want test-app-id", result.AppID)
	}

	if result.RefreshToken != "rt_test-refresh-token" {
		t.Errorf("RefreshToken mismatch: got %s, want rt_test-refresh-token", result.RefreshToken)
	}
}

func TestRefreshAPIKey(t *testing.T) {
	// Create mock server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/app/refresh" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		if r.Method != "POST" {
			t.Errorf("Expected POST method, got %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		contentType := r.Header.Get("Content-Type")
		if contentType != "application/json" {
			t.Errorf("Expected Content-Type application/json, got %s", contentType)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		var req refreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprintf(w, `{"error":"invalid request"}`)
			return
		}

		if req.RefreshToken != "rt_valid-refresh-token" {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintf(w, `{"error":"Invalid or expired refresh token"}`)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"apiKey":"new-api-key","refreshToken":"rt_new-refresh-token","appId":"test-app-id"}`)
	}))
	defer mockServer.Close()

	ctx := context.Background()

	// Test successful refresh
	config := RefreshAPIKeyConfig{
		ServerURL:    mockServer.URL,
		RefreshToken: "rt_valid-refresh-token",
	}

	result, err := RefreshAPIKey(ctx, config)
	if err != nil {
		t.Fatalf("RefreshAPIKey failed: %v", err)
	}

	if result.APIKey != "new-api-key" {
		t.Errorf("APIKey mismatch: got %s, want new-api-key", result.APIKey)
	}

	if result.RefreshToken != "rt_new-refresh-token" {
		t.Errorf("RefreshToken mismatch: got %s, want rt_new-refresh-token", result.RefreshToken)
	}

	if result.AppID != "test-app-id" {
		t.Errorf("AppID mismatch: got %s, want test-app-id", result.AppID)
	}
}

func TestRefreshAPIKeyInvalidToken(t *testing.T) {
	// Create mock server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprintf(w, `{"error":"Invalid or expired refresh token"}`)
	}))
	defer mockServer.Close()

	ctx := context.Background()

	config := RefreshAPIKeyConfig{
		ServerURL:    mockServer.URL,
		RefreshToken: "rt_invalid-token",
	}

	_, err := RefreshAPIKey(ctx, config)
	if err == nil {
		t.Error("Expected error for invalid refresh token")
	}
}

func TestSaveAndLoadCredentialsWithRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	credPath := filepath.Join(tmpDir, "credentials.env")

	// Save credentials with refresh token
	original := &SetupResult{
		APIKey:       "test-api-key-12345",
		AppID:        "test-app-id-67890",
		RefreshToken: "rt_test-refresh-token",
	}

	err := SaveCredentials(credPath, original)
	if err != nil {
		t.Fatalf("SaveCredentials failed: %v", err)
	}

	// Load credentials
	loaded, err := LoadCredentials(credPath)
	if err != nil {
		t.Fatalf("LoadCredentials failed: %v", err)
	}

	if loaded.APIKey != original.APIKey {
		t.Errorf("APIKey mismatch: got %s, want %s", loaded.APIKey, original.APIKey)
	}

	if loaded.AppID != original.AppID {
		t.Errorf("AppID mismatch: got %s, want %s", loaded.AppID, original.AppID)
	}

	if loaded.RefreshToken != original.RefreshToken {
		t.Errorf("RefreshToken mismatch: got %s, want %s", loaded.RefreshToken, original.RefreshToken)
	}
}

func TestUpdateCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	credPath := filepath.Join(tmpDir, "credentials.env")

	// Save initial credentials
	initial := &SetupResult{
		APIKey:       "old-api-key",
		AppID:        "test-app-id",
		RefreshToken: "rt_old-refresh-token",
	}
	err := SaveCredentials(credPath, initial)
	if err != nil {
		t.Fatalf("SaveCredentials failed: %v", err)
	}

	// Update with new credentials
	refreshResult := &RefreshAPIKeyResult{
		APIKey:       "new-api-key",
		RefreshToken: "rt_new-refresh-token",
		AppID:        "test-app-id",
	}

	err = UpdateCredentials(credPath, refreshResult)
	if err != nil {
		t.Fatalf("UpdateCredentials failed: %v", err)
	}

	// Load and verify
	loaded, err := LoadCredentials(credPath)
	if err != nil {
		t.Fatalf("LoadCredentials failed: %v", err)
	}

	if loaded.APIKey != "new-api-key" {
		t.Errorf("APIKey mismatch: got %s, want new-api-key", loaded.APIKey)
	}

	if loaded.RefreshToken != "rt_new-refresh-token" {
		t.Errorf("RefreshToken mismatch: got %s, want rt_new-refresh-token", loaded.RefreshToken)
	}

	if loaded.AppID != "test-app-id" {
		t.Errorf("AppID mismatch: got %s, want test-app-id", loaded.AppID)
	}
}
