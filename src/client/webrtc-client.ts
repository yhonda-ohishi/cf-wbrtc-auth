/**
 * Browser-side WebRTC client for P2P communication with Go apps
 * Works with SignalingClient for SDP/ICE exchange
 */

import { SignalingClient } from './ws-client';

interface RTCConfiguration {
  iceServers: RTCIceServer[];
}

interface PeerConnection {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  appId: string;
}

type EventCallback<T = unknown> = (data: T) => void;

interface DataChannelMessageEvent {
  appId: string;
  data: string | ArrayBuffer;
}

interface ConnectionStateChangeEvent {
  appId: string;
  state: RTCPeerConnectionState;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCClient {
  private signalingClient: SignalingClient;
  private peerConnections = new Map<string, PeerConnection>();
  private iceServers: RTCIceServer[];

  // Event callbacks
  public onDataChannelOpen: EventCallback<{ appId: string }> | null = null;
  public onDataChannelClose: EventCallback<{ appId: string }> | null = null;
  public onDataChannelMessage: EventCallback<DataChannelMessageEvent> | null = null;
  public onConnectionStateChange: EventCallback<ConnectionStateChangeEvent> | null = null;
  public onError: EventCallback<{ appId?: string; message: string }> | null = null;

  constructor(
    signalingClient: SignalingClient,
    iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS
  ) {
    this.signalingClient = signalingClient;
    this.iceServers = iceServers;

    // Set up signaling client event handlers
    this.setupSignalingHandlers();
  }

  /**
   * Set up handlers for signaling messages
   */
  private setupSignalingHandlers(): void {
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
  public async connectToApp(appId: string): Promise<RTCDataChannel> {
    // Check if already connected
    if (this.peerConnections.has(appId)) {
      const existing = this.peerConnections.get(appId)!;
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
    const peerConnection: PeerConnection = {
      pc,
      dataChannel,
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
      this.signalingClient.sendOffer(appId, offer.sdp!);

      // Wait for data channel to open
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Data channel connection timeout'));
          this.disconnect(appId);
        }, 30000); // 30 second timeout

        dataChannel.onopen = () => {
          clearTimeout(timeout);
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
    } catch (error) {
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
  public disconnect(appId?: string): void {
    if (appId) {
      // Disconnect specific app
      const peerConnection = this.peerConnections.get(appId);
      if (peerConnection) {
        this.closePeerConnection(peerConnection);
        this.peerConnections.delete(appId);
      }
    } else {
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
  public sendMessage(appId: string, data: string | ArrayBuffer): void {
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
      } else {
        peerConnection.dataChannel.send(data);
      }
    } catch (error) {
      this.onError?.({
        appId,
        message: `Failed to send message: ${error}`,
      });
    }
  }

  /**
   * Get connection state for a specific app
   */
  public getConnectionState(appId: string): RTCPeerConnectionState | null {
    const peerConnection = this.peerConnections.get(appId);
    return peerConnection?.pc.connectionState || null;
  }

  /**
   * Get data channel state for a specific app
   */
  public getDataChannelState(appId: string): RTCDataChannelState | null {
    const peerConnection = this.peerConnections.get(appId);
    return peerConnection?.dataChannel?.readyState || null;
  }

  /**
   * Get list of connected app IDs
   */
  public getConnectedApps(): string[] {
    return Array.from(this.peerConnections.keys()).filter((appId) => {
      const pc = this.peerConnections.get(appId);
      return pc?.dataChannel?.readyState === 'open';
    });
  }

  /**
   * Handle incoming answer from app
   */
  private async handleAnswer(appId: string, sdp: string): Promise<void> {
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
    } catch (error) {
      this.onError?.({
        appId,
        message: `Failed to set remote description: ${error}`,
      });
    }
  }

  /**
   * Handle incoming ICE candidate from app
   */
  private async handleIceCandidate(
    appId: string,
    candidate: RTCIceCandidate
  ): Promise<void> {
    const peerConnection = this.peerConnections.get(appId);
    if (!peerConnection) {
      console.warn(`Received ICE candidate for unknown app: ${appId}`);
      return;
    }

    try {
      await peerConnection.pc.addIceCandidate(candidate);
    } catch (error) {
      this.onError?.({
        appId,
        message: `Failed to add ICE candidate: ${error}`,
      });
    }
  }

  /**
   * Set up event handlers for a peer connection
   */
  private setupPeerConnectionHandlers(
    appId: string,
    pc: RTCPeerConnection
  ): void {
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
  private setupDataChannelHandlers(
    appId: string,
    dataChannel: RTCDataChannel
  ): void {
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
  private closePeerConnection(peerConnection: PeerConnection): void {
    const { pc, dataChannel, appId } = peerConnection;

    // Close data channel
    if (dataChannel) {
      try {
        dataChannel.close();
      } catch (error) {
        console.error('Error closing data channel:', error);
      }
    }

    // Close peer connection
    try {
      pc.close();
    } catch (error) {
      console.error('Error closing peer connection:', error);
    }

    // Notify closure
    this.onDataChannelClose?.({ appId });
  }
}
