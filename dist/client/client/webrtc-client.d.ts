/**
 * Browser-side WebRTC client for P2P communication with Go apps
 * Works with SignalingClient for SDP/ICE exchange
 */
import { SignalingClient } from './ws-client';
import { DataChannelTransport } from '../grpc/transport/datachannel-transport';
type EventCallback<T = unknown> = (data: T) => void;
interface DataChannelMessageEvent {
    appId: string;
    data: string | ArrayBuffer;
}
interface ConnectionStateChangeEvent {
    appId: string;
    state: RTCPeerConnectionState;
}
export declare class WebRTCClient {
    private signalingClient;
    private peerConnections;
    private iceServers;
    onDataChannelOpen: EventCallback<{
        appId: string;
    }> | null;
    onDataChannelClose: EventCallback<{
        appId: string;
    }> | null;
    onDataChannelMessage: EventCallback<DataChannelMessageEvent> | null;
    onConnectionStateChange: EventCallback<ConnectionStateChangeEvent> | null;
    onError: EventCallback<{
        appId?: string;
        message: string;
    }> | null;
    constructor(signalingClient: SignalingClient, iceServers?: RTCIceServer[]);
    /**
     * Set up handlers for signaling messages
     */
    private setupSignalingHandlers;
    /**
     * Connect to a specific app by creating an offer
     */
    connectToApp(appId: string): Promise<RTCDataChannel>;
    /**
     * Disconnect from a specific app or all apps
     */
    disconnect(appId?: string): void;
    /**
     * Send a message to a specific app
     */
    sendMessage(appId: string, data: string | ArrayBuffer): void;
    /**
     * Get connection state for a specific app
     */
    getConnectionState(appId: string): RTCPeerConnectionState | null;
    /**
     * Get data channel state for a specific app
     */
    getDataChannelState(appId: string): RTCDataChannelState | null;
    /**
     * Get list of connected app IDs
     */
    getConnectedApps(): string[];
    /**
     * Get the gRPC-Web transport for a specific app
     *
     * Use this to make typed RPC calls over the DataChannel connection.
     *
     * @example
     * ```typescript
     * const transport = webrtcClient.getTransport(appId);
     * if (transport) {
     *   const response = await transport.unary(
     *     '/mypackage.MyService/MyMethod',
     *     request,
     *     serializeRequest,
     *     deserializeResponse
     *   );
     * }
     * ```
     */
    getTransport(appId: string): DataChannelTransport | null;
    /**
     * Get the raw data channel for a specific app
     *
     * Use this for low-level access to the data channel.
     * For RPC calls, prefer using getTransport() instead.
     */
    getDataChannel(appId: string): RTCDataChannel | null;
    /**
     * Handle incoming answer from app
     */
    private handleAnswer;
    /**
     * Handle incoming ICE candidate from app
     */
    private handleIceCandidate;
    /**
     * Set up event handlers for a peer connection
     */
    private setupPeerConnectionHandlers;
    /**
     * Set up event handlers for a data channel
     */
    private setupDataChannelHandlers;
    /**
     * Close a peer connection and clean up resources
     */
    private closePeerConnection;
}
export {};
//# sourceMappingURL=webrtc-client.d.ts.map