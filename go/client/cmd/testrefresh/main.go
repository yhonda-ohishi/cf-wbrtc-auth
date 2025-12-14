// Package main tests the refresh token functionality
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/anthropics/cf-wbrtc-auth/go/client"
)

const defaultCredentialsFile = ".testclient-credentials"

func getCredentialsPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return defaultCredentialsFile
	}
	return filepath.Join(homeDir, defaultCredentialsFile)
}

func main() {
	serverURL := flag.String("server", "https://cf-wbrtc-auth.m-tama-ramu.workers.dev", "Server base URL")
	setup := flag.Bool("setup", false, "Run OAuth setup to get new credentials with refresh token")
	refresh := flag.Bool("refresh", false, "Refresh API key using stored refresh token")
	show := flag.Bool("show", false, "Show current credentials")
	flag.Parse()

	credPath := getCredentialsPath()

	if *show {
		creds, err := client.LoadCredentials(credPath)
		if err != nil {
			log.Fatalf("Failed to load credentials: %v", err)
		}
		fmt.Println("Current credentials:")
		fmt.Printf("  API Key: %s\n", creds.APIKey)
		fmt.Printf("  App ID: %s\n", creds.AppID)
		fmt.Printf("  Refresh Token: %s\n", creds.RefreshToken)
		return
	}

	if *setup {
		log.Println("Starting OAuth setup...")
		result, err := client.Setup(context.Background(), client.SetupConfig{
			ServerURL: *serverURL,
		})
		if err != nil {
			log.Fatalf("Setup failed: %v", err)
		}

		fmt.Println("\nSetup completed:")
		fmt.Printf("  API Key: %s\n", result.APIKey)
		fmt.Printf("  App ID: %s\n", result.AppID)
		fmt.Printf("  Refresh Token: %s\n", result.RefreshToken)

		if err := client.SaveCredentials(credPath, result); err != nil {
			log.Printf("Warning: failed to save credentials: %v", err)
		} else {
			log.Printf("Credentials saved to %s", credPath)
		}
		return
	}

	if *refresh {
		creds, err := client.LoadCredentials(credPath)
		if err != nil {
			log.Fatalf("Failed to load credentials: %v", err)
		}

		if creds.RefreshToken == "" {
			log.Fatal("No refresh token found. Run with -setup first to get a refresh token.")
		}

		log.Printf("Refreshing API key using refresh token...")
		log.Printf("Current API Key: %s...", creds.APIKey[:16])

		result, err := client.RefreshAPIKey(context.Background(), client.RefreshAPIKeyConfig{
			ServerURL:    *serverURL,
			RefreshToken: creds.RefreshToken,
		})
		if err != nil {
			log.Fatalf("Refresh failed: %v", err)
		}

		fmt.Println("\nRefresh completed:")
		fmt.Printf("  New API Key: %s\n", result.APIKey)
		fmt.Printf("  New Refresh Token: %s\n", result.RefreshToken)
		fmt.Printf("  App ID: %s\n", result.AppID)

		if err := client.UpdateCredentials(credPath, result); err != nil {
			log.Printf("Warning: failed to update credentials: %v", err)
		} else {
			log.Printf("Credentials updated in %s", credPath)
		}
		return
	}

	fmt.Println("Usage:")
	fmt.Println("  -show     Show current credentials")
	fmt.Println("  -setup    Run OAuth setup to get new credentials with refresh token")
	fmt.Println("  -refresh  Refresh API key using stored refresh token")
	fmt.Println("  -server   Server base URL (default: https://cf-wbrtc-auth.m-tama-ramu.workers.dev)")
}
