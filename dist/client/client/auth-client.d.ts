/**
 * Browser-side OAuth authentication client
 * Handles login flow with cf-wbrtc-auth and token management
 */
export interface AuthClientOptions {
    /** Base URL of the auth server (e.g., 'https://cf-wbrtc-auth.example.com') */
    authServerUrl: string;
    /** Storage type for token (default: 'localStorage') */
    storage?: 'localStorage' | 'sessionStorage';
}
export declare class AuthClient {
    private authServerUrl;
    private storage;
    constructor(options: AuthClientOptions);
    /**
     * Initiate login flow by redirecting to auth server
     * @param returnUrl URL to return to after login (default: current page)
     */
    login(returnUrl?: string): void;
    /**
     * Handle OAuth callback by extracting token from URL
     * Call this on page load to check for token in URL params
     * @returns Token if found in URL, null otherwise
     */
    handleCallback(): string | null;
    /**
     * Get stored token
     * @returns Token if exists, null otherwise
     */
    getToken(): string | null;
    /**
     * Check if user is logged in (has token)
     */
    isLoggedIn(): boolean;
    /**
     * Logout by clearing stored token
     */
    logout(): void;
    /**
     * Get WebSocket URL with token for SignalingClient
     * @returns WebSocket URL with token query param
     */
    getWebSocketUrl(): string;
    /**
     * Verify token is still valid by calling /api/me
     * @returns User info if token is valid, null otherwise
     */
    verifyToken(): Promise<{
        userId: string;
        email: string;
        name: string;
    } | null>;
}
//# sourceMappingURL=auth-client.d.ts.map