/**
 * Browser-side WebRTC client for P2P communication with Go apps
 * Works with SignalingClient for SDP/ICE exchange
 */
import { DataChannelTransport } from '../grpc/transport/datachannel-transport';
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];
export class WebRTCClient {
    constructor(signalingClient, iceServers = DEFAULT_ICE_SERVERS) {
        this.peerConnections = new Map();
        // Event callbacks
        this.onDataChannelOpen = null;
        this.onDataChannelClose = null;
        this.onDataChannelMessage = null;
        this.onConnectionStateChange = null;
        this.onError = null;
        this.signalingClient = signalingClient;
        this.iceServers = iceServers;
        // Set up signaling client event handlers
        this.setupSignalingHandlers();
    }
    /**
     * Set up handlers for signaling messages
     */
    setupSignalingHandlers() {
        // Handle incoming answers from apps
        this.signalingClient.onAnswer = (payload) => {
            const { sdp, appId } = payload;
            this.handleAnswer(appId, sdp);
        };
        // Handle incoming ICE candidates from apps
        this.signalingClient.onIce = (payload) => {
            const { candidate, appId } = payload;
            if (appId) {
                this.handleIceCandidate(appId, candidate);
            }
        };
        // Handle app status changes
        this.signalingClient.onAppStatus = (payload) => {
            if (payload.status === 'offline') {
                // App went offline, close connection if exists
                this.disconnect(payload.appId);
            }
        };
    }
    /**
     * Connect to a specific app by creating an offer
     */
    async connectToApp(appId) {
        // Check if already connected
        if (this.peerConnections.has(appId)) {
            const existing = this.peerConnections.get(appId);
            if (existing.dataChannel?.readyState === 'open') {
                return existing.dataChannel;
            }
            // Clean up stale connection
            this.disconnect(appId);
        }
        // Create new peer connection
        const pc = new RTCPeerConnection({
            iceServers: this.iceServers,
        });
        // Create data channel (browser initiates)
        const dataChannel = pc.createDataChannel('data', {
            ordered: true,
        });
        // Store peer connection
        const peerConnection = {
            pc,
            dataChannel,
            transport: null,
            appId,
        };
        this.peerConnections.set(appId, peerConnection);
        // Set up peer connection event handlers
        this.setupPeerConnectionHandlers(appId, pc);
        // Set up data channel event handlers
        this.setupDataChannelHandlers(appId, dataChannel);
        // Create and send offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            // Send offer through signaling server
            this.signalingClient.sendOffer(appId, offer.sdp);
            // Wait for data channel to open
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Data channel connection timeout'));
                    this.disconnect(appId);
                }, 30000); // 30 second timeout
                dataChannel.onopen = () => {
                    clearTimeout(timeout);
                    // Create transport for gRPC-Web over DataChannel
                    peerConnection.transport = new DataChannelTransport(dataChannel);
                    this.onDataChannelOpen?.({ appId });
                    resolve(dataChannel);
                };
                dataChannel.onerror = (error) => {
                    clearTimeout(timeout);
                    this.onError?.({
                        appId,
                        message: `Data channel error: ${error}`,
                    });
                    reject(error);
                };
            });
        }
        catch (error) {
            this.disconnect(appId);
            this.onError?.({
                appId,
                message: `Failed to create offer: ${error}`,
            });
            throw error;
        }
    }
    /**
     * Disconnect from a specific app or all apps
     */
    disconnect(appId) {
        if (appId) {
            // Disconnect specific app
            const peerConnection = this.peerConnections.get(appId);
            if (peerConnection) {
                this.closePeerConnection(peerConnection);
                this.peerConnections.delete(appId);
            }
        }
        else {
            // Disconnect all apps
            for (const [id, pc] of this.peerConnections.entries()) {
                this.closePeerConnection(pc);
            }
            this.peerConnections.clear();
        }
    }
    /**
     * Send a message to a specific app
     */
    sendMessage(appId, data) {
        const peerConnection = this.peerConnections.get(appId);
        if (!peerConnection?.dataChannel) {
            this.onError?.({
                appId,
                message: 'No data channel available for this app',
            });
            return;
        }
        if (peerConnection.dataChannel.readyState !== 'open') {
            this.onError?.({
                appId,
                message: `Data channel is not open (state: ${peerConnection.dataChannel.readyState})`,
            });
            return;
        }
        try {
            if (typeof data === 'string') {
                peerConnection.dataChannel.send(data);
            }
            else {
                peerConnection.dataChannel.send(data);
            }
        }
        catch (error) {
            this.onError?.({
                appId,
                message: `Failed to send message: ${error}`,
            });
        }
    }
    /**
     * Get connection state for a specific app
     */
    getConnectionState(appId) {
        const peerConnection = this.peerConnections.get(appId);
        return peerConnection?.pc.connectionState || null;
    }
    /**
     * Get data channel state for a specific app
     */
    getDataChannelState(appId) {
        const peerConnection = this.peerConnections.get(appId);
        return peerConnection?.dataChannel?.readyState || null;
    }
    /**
     * Get list of connected app IDs
     */
    getConnectedApps() {
        return Array.from(this.peerConnections.keys()).filter((appId) => {
            const pc = this.peerConnections.get(appId);
            return pc?.dataChannel?.readyState === 'open';
        });
    }
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
    getTransport(appId) {
        const peerConnection = this.peerConnections.get(appId);
        return peerConnection?.transport || null;
    }
    /**
     * Get the raw data channel for a specific app
     *
     * Use this for low-level access to the data channel.
     * For RPC calls, prefer using getTransport() instead.
     */
    getDataChannel(appId) {
        const peerConnection = this.peerConnections.get(appId);
        return peerConnection?.dataChannel || null;
    }
    /**
     * Handle incoming answer from app
     */
    async handleAnswer(appId, sdp) {
        const peerConnection = this.peerConnections.get(appId);
        if (!peerConnection) {
            console.warn(`Received answer for unknown app: ${appId}`);
            return;
        }
        try {
            const answer = new RTCSessionDescription({
                type: 'answer',
                sdp,
            });
            await peerConnection.pc.setRemoteDescription(answer);
        }
        catch (error) {
            this.onError?.({
                appId,
                message: `Failed to set remote description: ${error}`,
            });
        }
    }
    /**
     * Handle incoming ICE candidate from app
     */
    async handleIceCandidate(appId, candidate) {
        const peerConnection = this.peerConnections.get(appId);
        if (!peerConnection) {
            console.warn(`Received ICE candidate for unknown app: ${appId}`);
            return;
        }
        try {
            await peerConnection.pc.addIceCandidate(candidate);
        }
        catch (error) {
            this.onError?.({
                appId,
                message: `Failed to add ICE candidate: ${error}`,
            });
        }
    }
    /**
     * Set up event handlers for a peer connection
     */
    setupPeerConnectionHandlers(appId, pc) {
        // ICE candidate generation
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.signalingClient.sendIce(event.candidate, appId);
            }
        };
        // Connection state changes
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            this.onConnectionStateChange?.({ appId, state });
            // Clean up on failure or closure
            if (state === 'failed' || state === 'closed') {
                this.disconnect(appId);
            }
        };
        // ICE connection state changes
        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            if (state === 'failed' || state === 'closed') {
                this.onError?.({
                    appId,
                    message: `ICE connection ${state}`,
                });
            }
        };
        // Handle data channels created by remote peer (shouldn't happen in browser-initiated flow)
        pc.ondatachannel = (event) => {
            console.warn('Unexpected data channel from remote peer:', event.channel.label);
            // Could handle this if apps also create data channels
        };
    }
    /**
     * Set up event handlers for a data channel
     */
    setupDataChannelHandlers(appId, dataChannel) {
        dataChannel.onopen = () => {
            this.onDataChannelOpen?.({ appId });
        };
        dataChannel.onclose = () => {
            this.onDataChannelClose?.({ appId });
        };
        dataChannel.onmessage = (event) => {
            this.onDataChannelMessage?.({
                appId,
                data: event.data,
            });
        };
        dataChannel.onerror = (error) => {
            this.onError?.({
                appId,
                message: `Data channel error: ${error}`,
            });
        };
    }
    /**
     * Close a peer connection and clean up resources
     */
    closePeerConnection(peerConnection) {
        const { pc, dataChannel, transport, appId } = peerConnection;
        // Close transport (will also close data channel)
        if (transport) {
            try {
                transport.close();
            }
            catch (error) {
                console.error('Error closing transport:', error);
            }
        }
        // Close data channel (if transport didn't close it)
        if (dataChannel) {
            try {
                dataChannel.close();
            }
            catch (error) {
                console.error('Error closing data channel:', error);
            }
        }
        // Close peer connection
        try {
            pc.close();
        }
        catch (error) {
            console.error('Error closing peer connection:', error);
        }
        // Notify closure
        this.onDataChannelClose?.({ appId });
    }
}
