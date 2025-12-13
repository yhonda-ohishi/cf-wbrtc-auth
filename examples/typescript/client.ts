/**
 * gRPC-Web Client over DataChannel - Example Usage
 *
 * This example demonstrates how to:
 * 1. Create a DataChannelTransport from an existing RTCDataChannel
 * 2. Make unary RPC calls
 * 3. Use server reflection to discover available methods
 * 4. Handle errors
 *
 * Note: This is a demonstration file showing API usage patterns.
 */

import {
  DataChannelTransport,
  GrpcError,
  ReflectionClient,
  StatusCode,
} from '../../src/grpc';

// Example request/response types (in real usage, these would be generated from proto)
interface EchoRequest {
  message: string;
}

interface EchoResponse {
  reply: string;
}

// JSON serialization helpers (in real usage, use protobuf)
function serializeJSON<T>(obj: T): Uint8Array {
  const json = JSON.stringify(obj);
  return new TextEncoder().encode(json);
}

function deserializeJSON<T>(data: Uint8Array): T {
  const json = new TextDecoder().decode(data);
  return JSON.parse(json) as T;
}

/**
 * Basic example: Making a simple RPC call
 */
async function basicExample(dataChannel: RTCDataChannel): Promise<void> {
  // Create transport from DataChannel
  const transport = new DataChannelTransport(dataChannel);

  try {
    // Make an Echo call
    const response = await transport.unary<EchoRequest, EchoResponse>(
      '/example.EchoService/Echo',
      { message: 'Hello, World!' },
      serializeJSON,
      deserializeJSON
    );

    console.log('Response:', response.message.reply);
    // Output: Response: Echo: Hello, World!

    // Access response headers/trailers if needed
    console.log('Headers:', response.headers);
    console.log('Trailers:', response.trailers);
  } finally {
    // Clean up
    transport.close();
  }
}

/**
 * Using server reflection to discover available services
 */
async function reflectionExample(dataChannel: RTCDataChannel): Promise<void> {
  const transport = new DataChannelTransport(dataChannel);
  const reflection = new ReflectionClient(transport);

  try {
    // List all available services
    const services = await reflection.listServices();

    console.log('Available services:');
    for (const service of services.services) {
      console.log(`  ${service.name}:`);
      for (const method of service.methods) {
        // Get the full method path
        const path = ReflectionClient.getMethodPath(service.name, method);
        console.log(`    - ${method} (${path})`);
      }
    }
  } finally {
    transport.close();
  }
}

/**
 * Error handling example
 */
async function errorHandlingExample(dataChannel: RTCDataChannel): Promise<void> {
  const transport = new DataChannelTransport(dataChannel);

  try {
    const response = await transport.unary<EchoRequest, EchoResponse>(
      '/example.EchoService/ValidatedEcho',
      { message: '' }, // Empty message will cause error
      serializeJSON,
      deserializeJSON
    );

    console.log('Unexpected success:', response);
  } catch (error) {
    if (error instanceof GrpcError) {
      // Handle gRPC-specific errors
      console.log('gRPC Error:');
      console.log(`  Code: ${error.code} (${getStatusCodeName(error.code)})`);
      console.log(`  Message: ${error.message}`);
      console.log(`  Trailers:`, error.trailers);

      // Handle specific error codes
      switch (error.code) {
        case StatusCode.INVALID_ARGUMENT:
          console.log('  -> Invalid input, please check your request');
          break;
        case StatusCode.PERMISSION_DENIED:
          console.log('  -> Access denied');
          break;
        case StatusCode.NOT_FOUND:
          console.log('  -> Resource not found');
          break;
        default:
          console.log('  -> Unexpected error');
      }
    } else {
      // Handle other errors (network, timeout, etc.)
      console.log('Non-gRPC error:', error);
    }
  } finally {
    transport.close();
  }
}

/**
 * Example with custom timeout and headers
 */
async function advancedOptionsExample(dataChannel: RTCDataChannel): Promise<void> {
  const transport = new DataChannelTransport(dataChannel);

  try {
    const response = await transport.unary<EchoRequest, EchoResponse>(
      '/example.EchoService/Echo',
      { message: 'With options' },
      serializeJSON,
      deserializeJSON,
      {
        timeout: 5000, // 5 second timeout
        headers: {
          authorization: 'Bearer my-token',
          'x-custom-header': 'custom-value',
        },
      }
    );

    console.log('Response:', response.message);
  } finally {
    transport.close();
  }
}

/**
 * Example: Multiple concurrent requests
 */
async function concurrentRequestsExample(
  dataChannel: RTCDataChannel
): Promise<void> {
  const transport = new DataChannelTransport(dataChannel);

  try {
    // Make multiple requests concurrently
    const [echo, reverse] = await Promise.all([
      transport.unary<EchoRequest, EchoResponse>(
        '/example.EchoService/Echo',
        { message: 'Hello' },
        serializeJSON,
        deserializeJSON
      ),
      transport.unary<EchoRequest, EchoResponse>(
        '/example.EchoService/Reverse',
        { message: 'Hello' },
        serializeJSON,
        deserializeJSON
      ),
    ]);

    console.log('Echo:', echo.message.reply); // "Echo: Hello"
    console.log('Reverse:', reverse.message.reply); // "olleH"
  } finally {
    transport.close();
  }
}

/**
 * Helper: Get human-readable status code name
 */
function getStatusCodeName(code: number): string {
  const names: Record<number, string> = {
    [StatusCode.OK]: 'OK',
    [StatusCode.CANCELLED]: 'CANCELLED',
    [StatusCode.UNKNOWN]: 'UNKNOWN',
    [StatusCode.INVALID_ARGUMENT]: 'INVALID_ARGUMENT',
    [StatusCode.DEADLINE_EXCEEDED]: 'DEADLINE_EXCEEDED',
    [StatusCode.NOT_FOUND]: 'NOT_FOUND',
    [StatusCode.ALREADY_EXISTS]: 'ALREADY_EXISTS',
    [StatusCode.PERMISSION_DENIED]: 'PERMISSION_DENIED',
    [StatusCode.RESOURCE_EXHAUSTED]: 'RESOURCE_EXHAUSTED',
    [StatusCode.FAILED_PRECONDITION]: 'FAILED_PRECONDITION',
    [StatusCode.ABORTED]: 'ABORTED',
    [StatusCode.OUT_OF_RANGE]: 'OUT_OF_RANGE',
    [StatusCode.UNIMPLEMENTED]: 'UNIMPLEMENTED',
    [StatusCode.INTERNAL]: 'INTERNAL',
    [StatusCode.UNAVAILABLE]: 'UNAVAILABLE',
    [StatusCode.DATA_LOSS]: 'DATA_LOSS',
    [StatusCode.UNAUTHENTICATED]: 'UNAUTHENTICATED',
  };
  return names[code] || 'UNKNOWN';
}

// Export examples for documentation
export {
  basicExample,
  reflectionExample,
  errorHandlingExample,
  advancedOptionsExample,
  concurrentRequestsExample,
};
