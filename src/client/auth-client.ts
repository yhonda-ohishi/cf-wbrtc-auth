/**
 * Browser-side OAuth authentication client
 * Handles login flow with cf-wbrtc-auth and token management
 */

const TOKEN_STORAGE_KEY = 'cf_wbrtc_auth_token';

export interface AuthClientOptions {
  /** Base URL of the auth server (e.g., 'https://cf-wbrtc-auth.example.com') */
  authServerUrl: string;
  /** Storage type for token (default: 'localStorage') */
  storage?: 'localStorage' | 'sessionStorage';
}

export class AuthClient {
  private authServerUrl: string;
  private storage: Storage;

  constructor(options: AuthClientOptions) {
    this.authServerUrl = options.authServerUrl.replace(/\/$/, ''); // Remove trailing slash
    this.storage = options.storage === 'sessionStorage' ? sessionStorage : localStorage;
  }

  /**
   * Initiate login flow by redirecting to auth server
   * @param returnUrl URL to return to after login (default: current page)
   */
  public login(returnUrl?: string): void {
    const redirect = returnUrl || window.location.href;
    const loginUrl = `${this.authServerUrl}/auth/login?return=${encodeURIComponent(redirect)}`;
    window.location.href = loginUrl;
  }

  /**
   * Handle OAuth callback by extracting token from URL
   * Call this on page load to check for token in URL params
   * @returns Token if found in URL, null otherwise
   */
  public handleCallback(): string | null {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');

    if (token) {
      // Save token to storage
      this.storage.setItem(TOKEN_STORAGE_KEY, token);

      // Clean up URL (remove token param)
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.toString());

      return token;
    }

    return null;
  }

  /**
   * Get stored token
   * @returns Token if exists, null otherwise
   */
  public getToken(): string | null {
    return this.storage.getItem(TOKEN_STORAGE_KEY);
  }

  /**
   * Check if user is logged in (has token)
   */
  public isLoggedIn(): boolean {
    return this.getToken() !== null;
  }

  /**
   * Logout by clearing stored token
   */
  public logout(): void {
    this.storage.removeItem(TOKEN_STORAGE_KEY);
  }

  /**
   * Get WebSocket URL with token for SignalingClient
   * @returns WebSocket URL with token query param
   */
  public getWebSocketUrl(): string {
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
  public async verifyToken(): Promise<{ userId: string; email: string; name: string } | null> {
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
    } catch (error) {
      console.error('Failed to verify token:', error);
      return null;
    }
  }
}
