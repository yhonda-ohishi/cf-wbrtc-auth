/**
 * gRPC Server Reflection Client
 *
 * This module provides a client for querying available services
 * from a gRPC server that supports reflection.
 */
import { DataChannelTransport, type CallOptions } from '../transport/datachannel-transport';
/** Method path for the ListServices reflection method */
export declare const REFLECTION_METHOD_PATH = "/grpc.reflection.v1alpha.ServerReflection/ListServices";
/** Information about a registered service */
export interface ServiceInfo {
    name: string;
    methods: string[];
}
/** Response from ListServices */
export interface ListServicesResponse {
    services: ServiceInfo[];
}
/**
 * Reflection client for querying available services
 */
export declare class ReflectionClient {
    private transport;
    constructor(transport: DataChannelTransport);
    /**
     * List all available services on the server
     *
     * @param options - Call options (timeout, headers)
     * @returns Promise resolving to the list of services
     */
    listServices(options?: CallOptions): Promise<ListServicesResponse>;
    /**
     * Get the full method path for a method
     *
     * @param serviceName - Service name (e.g., "mypackage.MyService")
     * @param methodName - Method name (e.g., "GetUser")
     * @returns Full method path (e.g., "/mypackage.MyService/GetUser")
     */
    static getMethodPath(serviceName: string, methodName: string): string;
}
//# sourceMappingURL=reflection.d.ts.map