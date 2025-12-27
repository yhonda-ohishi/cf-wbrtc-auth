/**
 * DataChannel Transport for gRPC-Web
 *
 * Enables gRPC-Web style RPC calls over WebRTC DataChannel.
 * Compatible with Connect-Web's Transport interface pattern.
 *
 * Features:
 * - Multiple concurrent requests using request IDs
 * - Timeout handling
 * - Error responses (throws GrpcError)
 * - Channel closing (rejects all pending requests)
 */
import { encodeRequest, decodeResponse, isErrorResponse, getError, StatusCode, isStreamMessage, decodeStreamMessage, StreamFlag, } from '../codec/envelope';
import { decodeFrames, parseTrailers, FRAME_DATA, FRAME_TRAILER } from '../codec/frame';
/**
 * Error thrown on gRPC errors
 */
export class GrpcError extends Error {
    constructor(code, message, trailers) {
        super(message);
        this.code = code;
        this.trailers = trailers;
        this.name = 'GrpcError';
    }
}
/**
 * DataChannel Transport for gRPC-Web over WebRTC
 *
 * This transport wraps an RTCDataChannel and provides a high-level API
 * for making gRPC-Web style RPC calls. It handles request/response correlation
 * using request IDs, allowing multiple concurrent requests.
 */
export class DataChannelTransport {
    constructor(dataChannel) {
        this.pendingRequests = new Map();
        this.pendingStreamRequests = new Map();
        this.requestIdCounter = 0;
        this.closed = false;
        this.dataChannel = dataChannel;
        // Set binary type to arraybuffer for receiving binary data
        this.dataChannel.binaryType = 'arraybuffer';
        // Set up message handler
        this.dataChannel.addEventListener('message', this.handleMessage.bind(this));
        // Set up close handler
        this.dataChannel.addEventListener('close', this.handleClose.bind(this));
        this.dataChannel.addEventListener('error', this.handleError.bind(this));
    }
    /**
     * Perform a unary RPC call
     *
     * @param path - Full method path, e.g., "/package.Service/Method"
     * @param request - Request message object
     * @param serialize - Function to serialize request message to bytes
     * @param deserialize - Function to deserialize response bytes to message
     * @param options - Call options (timeout, headers)
     * @returns Promise resolving to the response
     */
    async unary(path, request, serialize, deserialize, options) {
        // Serialize request message
        const messageBytes = serialize(request);
        // Generate request ID and prepare headers
        const requestId = this.generateRequestId();
        const headers = {
            'x-request-id': requestId,
            ...(options?.headers || {}),
        };
        // Create request envelope
        const envelope = {
            path,
            headers,
            message: messageBytes,
        };
        // Send request and wait for response
        const responseEnvelope = await this.call(envelope, options);
        // Validate response has exactly one message for unary call
        if (responseEnvelope.messages.length === 0) {
            throw new Error('No response message received for unary call');
        }
        if (responseEnvelope.messages.length > 1) {
            throw new Error(`Expected single response message, got ${responseEnvelope.messages.length}`);
        }
        // Deserialize response message
        const message = deserialize(responseEnvelope.messages[0]);
        return {
            message,
            headers: responseEnvelope.headers,
            trailers: responseEnvelope.trailers,
        };
    }
    /**
     * Perform a server streaming RPC call
     *
     * @param path - Full method path, e.g., "/package.Service/Method"
     * @param request - Request message object
     * @param serialize - Function to serialize request message to bytes
     * @param deserialize - Function to deserialize response bytes to message
     * @param options - Call options (timeout, headers)
     * @returns StreamingResponse with async iterable messages
     */
    serverStreaming(path, request, serialize, deserialize, options) {
        if (this.closed) {
            throw new Error('Transport is closed');
        }
        // Serialize request message
        const messageBytes = serialize(request);
        // Generate request ID with stream- prefix for easier identification
        this.requestIdCounter++;
        const requestId = `stream-${Date.now()}-${this.requestIdCounter}`;
        const headers = {
            'x-request-id': requestId,
            ...(options?.headers || {}),
        };
        // Create request envelope
        const envelope = {
            path,
            headers,
            message: messageBytes,
        };
        // Set up timeout
        const timeoutMs = options?.timeout || 30000;
        // Message queue for async iteration
        const messageQueue = [];
        let resolveNext = null;
        let streamEnded = false;
        let streamError = null;
        let trailers = {};
        // Set up timeout
        const timeout = setTimeout(() => {
            this.pendingStreamRequests.delete(requestId);
            streamError = new Error(`Request timeout after ${timeoutMs}ms`);
            streamEnded = true;
            if (resolveNext) {
                resolveNext({ done: true, value: undefined });
            }
        }, timeoutMs);
        // Register stream handlers
        this.pendingStreamRequests.set(requestId, {
            onMessage: (data) => {
                try {
                    const message = deserialize(data);
                    if (resolveNext) {
                        const resolve = resolveNext;
                        resolveNext = null;
                        resolve({ done: false, value: message });
                    }
                    else {
                        messageQueue.push(message);
                    }
                }
                catch (err) {
                    streamError = err instanceof Error ? err : new Error(String(err));
                }
            },
            onEnd: (endTrailers) => {
                clearTimeout(timeout);
                trailers = endTrailers;
                streamEnded = true;
                // Check for gRPC error in trailers
                const status = endTrailers['grpc-status'];
                if (status && parseInt(status, 10) !== StatusCode.OK) {
                    const code = parseInt(status, 10);
                    const message = endTrailers['grpc-message'] || 'Unknown error';
                    streamError = new GrpcError(code, message, endTrailers);
                }
                if (resolveNext) {
                    const resolve = resolveNext;
                    resolveNext = null;
                    if (streamError) {
                        // For errors, we still complete the iterator but the error is accessible
                        resolve({ done: true, value: undefined });
                    }
                    else {
                        resolve({ done: true, value: undefined });
                    }
                }
            },
            onError: (error) => {
                clearTimeout(timeout);
                this.pendingStreamRequests.delete(requestId);
                streamError = error;
                streamEnded = true;
                if (resolveNext) {
                    const resolve = resolveNext;
                    resolveNext = null;
                    resolve({ done: true, value: undefined });
                }
            },
            timeout,
        });
        // Send request
        const encodedRequest = encodeRequest(envelope);
        try {
            this.dataChannel.send(encodedRequest);
        }
        catch (error) {
            clearTimeout(timeout);
            this.pendingStreamRequests.delete(requestId);
            throw error;
        }
        // Create async iterator
        const asyncIterator = {
            next: () => {
                // Check for queued messages first
                if (messageQueue.length > 0) {
                    return Promise.resolve({ done: false, value: messageQueue.shift() });
                }
                // Check if stream ended
                if (streamEnded) {
                    if (streamError) {
                        return Promise.reject(streamError);
                    }
                    return Promise.resolve({ done: true, value: undefined });
                }
                // Wait for next message
                return new Promise((resolve) => {
                    resolveNext = resolve;
                });
            },
        };
        return {
            headers: {}, // Headers are not sent separately in our protocol
            get trailers() {
                return trailers;
            },
            messages: {
                [Symbol.asyncIterator]: () => asyncIterator,
            },
        };
    }
    /**
     * Low-level method to send raw request and get raw response
     *
     * @param envelope - Request envelope
     * @param options - Call options
     * @returns Promise resolving to response envelope
     * @throws {GrpcError} If the server returns an error status
     * @throws {Error} If the transport is closed or times out
     */
    async call(envelope, options) {
        if (this.closed) {
            throw new Error('Transport is closed');
        }
        // Extract request ID from headers
        const requestId = envelope.headers['x-request-id'];
        if (!requestId) {
            throw new Error('Request envelope must include x-request-id header');
        }
        // Set up timeout
        const timeoutMs = options?.timeout || 30000;
        // Create promise for response
        const responsePromise = new Promise((resolve, reject) => {
            // Set up timeout
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Request timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            // Store pending request
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timeout,
            });
        });
        // Encode and send request
        const encodedRequest = encodeRequest(envelope);
        try {
            // Cast to ArrayBuffer for RTCDataChannel.send compatibility
            this.dataChannel.send(encodedRequest);
        }
        catch (error) {
            // Clean up pending request on send failure
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(requestId);
            }
            throw error;
        }
        // Wait for response
        const responseEnvelope = await responsePromise;
        // Check for gRPC errors
        if (isErrorResponse(responseEnvelope)) {
            const error = getError(responseEnvelope);
            if (error) {
                throw new GrpcError(error.code, error.message, responseEnvelope.trailers);
            }
            else {
                throw new GrpcError(StatusCode.UNKNOWN, 'Unknown error', responseEnvelope.trailers);
            }
        }
        return responseEnvelope;
    }
    /**
     * Close the transport and clean up
     *
     * This will reject all pending requests and close the DataChannel.
     */
    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        // Reject all pending requests
        const error = new Error('Transport closed');
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pendingRequests.clear();
        // Close all pending stream requests
        for (const [requestId, pending] of this.pendingStreamRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.onError(error);
        }
        this.pendingStreamRequests.clear();
        // Close DataChannel
        if (this.dataChannel.readyState === 'open') {
            this.dataChannel.close();
        }
        // Remove event listeners
        this.dataChannel.removeEventListener('message', this.handleMessage.bind(this));
        this.dataChannel.removeEventListener('close', this.handleClose.bind(this));
        this.dataChannel.removeEventListener('error', this.handleError.bind(this));
    }
    /**
     * Generate a unique request ID
     */
    generateRequestId() {
        this.requestIdCounter++;
        return `req-${Date.now()}-${this.requestIdCounter}`;
    }
    /**
     * Handle incoming message from DataChannel
     */
    handleMessage(event) {
        if (this.closed) {
            return;
        }
        // Convert ArrayBuffer to Uint8Array
        const data = new Uint8Array(event.data);
        try {
            // Check if this is a stream message
            if (isStreamMessage(data)) {
                this.handleStreamMessage(data);
                return;
            }
            // Decode response envelope (unary response)
            const responseEnvelope = decodeResponse(data);
            // Extract request ID from response headers
            const requestId = responseEnvelope.headers['x-request-id'];
            if (!requestId) {
                console.error('Received response without x-request-id header');
                return;
            }
            // Find pending unary request
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
                // Clean up timeout
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(requestId);
                // Resolve promise
                pending.resolve(responseEnvelope);
                return;
            }
            // Fallback: Check streaming requests (server may send stream response in Unary format)
            const streamPending = this.pendingStreamRequests.get(requestId);
            if (streamPending) {
                // Process data frames as stream messages
                if (responseEnvelope.messages.length > 0) {
                    for (const msg of responseEnvelope.messages) {
                        streamPending.onMessage(msg);
                    }
                }
                // Check trailers for end of stream
                const status = responseEnvelope.trailers['grpc-status'];
                if (status !== undefined) {
                    this.pendingStreamRequests.delete(requestId);
                    streamPending.onEnd(responseEnvelope.trailers);
                }
                return;
            }
            console.warn(`Received response for unknown request ID: ${requestId}`);
        }
        catch (error) {
            console.error('Failed to decode response:', error);
            // We don't know which request this belongs to, so we can't reject it
        }
    }
    /**
     * Handle incoming stream message
     */
    handleStreamMessage(data) {
        try {
            const streamMsg = decodeStreamMessage(data);
            const pending = this.pendingStreamRequests.get(streamMsg.requestId);
            if (!pending) {
                console.warn(`Received stream message for unknown request ID: ${streamMsg.requestId}`);
                return;
            }
            if (streamMsg.flag === StreamFlag.DATA) {
                // Decode the frame to get the message data
                const { frames } = decodeFrames(streamMsg.data);
                for (const frame of frames) {
                    if (frame.flags === FRAME_DATA) {
                        pending.onMessage(frame.data);
                    }
                }
            }
            else if (streamMsg.flag === StreamFlag.END) {
                // Decode trailer frame
                const { frames } = decodeFrames(streamMsg.data);
                let trailers = {};
                for (const frame of frames) {
                    if (frame.flags === FRAME_TRAILER) {
                        trailers = parseTrailers(frame.data);
                    }
                }
                this.pendingStreamRequests.delete(streamMsg.requestId);
                pending.onEnd(trailers);
            }
        }
        catch (error) {
            console.error('Failed to handle stream message:', error);
        }
    }
    /**
     * Handle DataChannel close event
     */
    handleClose() {
        if (this.closed) {
            return;
        }
        // Reject all pending requests
        const error = new Error('DataChannel closed');
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pendingRequests.clear();
        // Close all pending stream requests
        for (const [requestId, pending] of this.pendingStreamRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.onError(error);
        }
        this.pendingStreamRequests.clear();
        this.closed = true;
    }
    /**
     * Handle DataChannel error event
     */
    handleError(event) {
        console.error('DataChannel error:', event);
        // The close event will be fired next, which will clean up
    }
    /**
     * Get the underlying DataChannel
     *
     * Useful for checking connection state or adding custom event listeners.
     */
    get channel() {
        return this.dataChannel;
    }
    /**
     * Check if the transport is closed
     */
    get isClosed() {
        return this.closed;
    }
    /**
     * Get the number of pending requests
     */
    get pendingCount() {
        return this.pendingRequests.size;
    }
}
