/**
 * Browser-side OAuth authentication client
 * Handles login flow with cf-wbrtc-auth and token management
 */
const TOKEN_STORAGE_KEY = 'cf_wbrtc_auth_token';
export class AuthClient {
    constructor(options) {
        this.authServerUrl = options.authServerUrl.replace(/\/$/, ''); // Remove trailing slash
        this.storage = options.storage === 'sessionStorage' ? sessionStorage : localStorage;
    }
    /**
     * Initiate login flow by redirecting to auth server
     * @param returnUrl URL to return to after login (default: current page)
     */
    login(returnUrl) {
        const redirect = returnUrl || window.location.href;
        const loginUrl = `${this.authServerUrl}/auth/login?return=${encodeURIComponent(redirect)}`;
        window.location.href = loginUrl;
    }
    /**
     * Handle OAuth callback by extracting auth code from URL and exchanging it for a token
     * Call this on page load to check for code in URL params
     * @returns Token if successfully exchanged, null otherwise
     */
    async handleCallback() {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (!code) {
            return null;
        }
        // Clean up URL immediately (remove code param)
        url.searchParams.delete('code');
        window.history.replaceState({}, document.title, url.toString());
        try {
            // Exchange code for token
            const response = await fetch(`${this.authServerUrl}/auth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code }),
            });
            if (!response.ok) {
                console.error('Failed to exchange code for token');
                return null;
            }
            const data = await response.json();
            const { token } = data;
            // Save token to storage
            console.log('[AuthClient] Saving token to storage, key:', TOKEN_STORAGE_KEY);
            console.log('[AuthClient] Storage type:', this.storage === localStorage ? 'localStorage' : 'sessionStorage');
            this.storage.setItem(TOKEN_STORAGE_KEY, token);
            console.log('[AuthClient] Token saved, verify:', this.storage.getItem(TOKEN_STORAGE_KEY) ? 'SUCCESS' : 'FAILED');
            return token;
        }
        catch (error) {
            console.error('Failed to exchange code for token:', error);
            return null;
        }
    }
    /**
     * Get stored token
     * @returns Token if exists, null otherwise
     */
    getToken() {
        return this.storage.getItem(TOKEN_STORAGE_KEY);
    }
    /**
     * Check if user is logged in (has token)
     */
    isLoggedIn() {
        return this.getToken() !== null;
    }
    /**
     * Logout by clearing stored token
     */
    logout() {
        this.storage.removeItem(TOKEN_STORAGE_KEY);
    }
    /**
     * Get WebSocket URL with token for SignalingClient
     * @returns WebSocket URL with token query param
     */
    getWebSocketUrl() {
        const token = this.getToken();
        const wsProtocol = this.authServerUrl.startsWith('https') ? 'wss' : 'ws';
        const host = this.authServerUrl.replace(/^https?:\/\//, '');
        const wsUrl = `${wsProtocol}://${host}/ws`;
        if (token) {
            return `${wsUrl}?token=${encodeURIComponent(token)}`;
        }
        return wsUrl;
    }
    /**
     * Verify token is still valid by calling /api/me
     * @returns User info if token is valid, null otherwise
     */
    async verifyToken() {
        const token = this.getToken();
        if (!token) {
            return null;
        }
        try {
            const response = await fetch(`${this.authServerUrl}/api/me`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (response.ok) {
                return await response.json();
            }
            // Token is invalid, clear it
            this.logout();
            return null;
        }
        catch (error) {
            console.error('Failed to verify token:', error);
            return null;
        }
    }
}
