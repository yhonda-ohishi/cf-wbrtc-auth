/**
 * Browser-side WebSocket client for Cloudflare Workers signaling server
 */
interface AppInfo {
    appId: string;
    name: string;
    capabilities?: string[];
    status: 'online' | 'offline';
}
interface AuthOkPayload {
    userId: string;
    type: 'browser' | 'app';
}
interface AuthErrorPayload {
    error: string;
}
interface AppsListPayload {
    apps: AppInfo[];
}
interface AppStatusPayload {
    appId: string;
    name?: string;
    capabilities?: string[];
    status: 'online' | 'offline';
}
interface OfferPayload {
    sdp: string;
}
interface AnswerPayload {
    sdp: string;
    appId: string;
}
interface IcePayload {
    candidate: RTCIceCandidate;
    appId?: string;
}
type EventCallback<T = unknown> = (data: T) => void;
export declare class SignalingClient {
    private ws;
    private wsUrl;
    private token;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectTimeout;
    private isManualDisconnect;
    private isAuthenticated;
    onAuthenticated: EventCallback<AuthOkPayload> | null;
    onAuthError: EventCallback<AuthErrorPayload> | null;
    onAppStatus: EventCallback<AppStatusPayload> | null;
    onAppsListReceived: EventCallback<AppsListPayload> | null;
    onOffer: EventCallback<OfferPayload> | null;
    onAnswer: EventCallback<AnswerPayload> | null;
    onIce: EventCallback<IcePayload> | null;
    onConnected: EventCallback<void> | null;
    onDisconnected: EventCallback<void> | null;
    onError: EventCallback<{
        message: string;
    }> | null;
    constructor(wsUrl: string, token?: string | null);
    /**
     * Connect to the WebSocket signaling server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the WebSocket server
     */
    disconnect(): void;
    /**
     * Check if the client is connected and authenticated
     */
    isConnected(): boolean;
    /**
     * Send authentication message
     */
    private sendAuth;
    /**
     * Send WebRTC offer to a specific app
     */
    sendOffer(targetAppId: string, sdp: string): void;
    /**
     * Send WebRTC answer
     */
    sendAnswer(sdp: string): void;
    /**
     * Send ICE candidate
     */
    sendIce(candidate: RTCIceCandidate, targetAppId?: string): void;
    /**
     * Request list of online apps
     */
    getApps(): void;
    /**
     * Send a message to the server
     */
    private send;
    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage;
    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect;
    /**
     * Update the JWT token (useful for token refresh)
     */
    updateToken(token: string): void;
}
export {};
//# sourceMappingURL=ws-client.d.ts.map