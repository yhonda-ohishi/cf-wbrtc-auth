/**
 * gRPC Server Reflection Client
 *
 * This module provides a client for querying available services
 * from a gRPC server that supports reflection.
 */
/** Method path for the ListServices reflection method */
export const REFLECTION_METHOD_PATH = '/grpc.reflection.v1alpha.ServerReflection/ListServices';
/**
 * Reflection client for querying available services
 */
export class ReflectionClient {
    constructor(transport) {
        this.transport = transport;
    }
    /**
     * List all available services on the server
     *
     * @param options - Call options (timeout, headers)
     * @returns Promise resolving to the list of services
     */
    async listServices(options) {
        const response = await this.transport.unary(REFLECTION_METHOD_PATH, new Uint8Array(0), // Empty request
        (msg) => msg, // Pass through
        (data) => {
            // Parse JSON response
            const text = new TextDecoder().decode(data);
            return JSON.parse(text);
        }, options);
        return response.message;
    }
    /**
     * Get the full method path for a method
     *
     * @param serviceName - Service name (e.g., "mypackage.MyService")
     * @param methodName - Method name (e.g., "GetUser")
     * @returns Full method path (e.g., "/mypackage.MyService/GetUser")
     */
    static getMethodPath(serviceName, methodName) {
        return `/${serviceName}/${methodName}`;
    }
}
