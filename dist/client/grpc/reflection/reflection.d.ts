/**
 * gRPC Server Reflection Client
 *
 * This module provides a client for querying available services
 * from a gRPC server that supports reflection.
 */
import { DataChannelTransport, type CallOptions } from '../transport/datachannel-transport';
/** Method path for the ListServices reflection method */
export declare const REFLECTION_METHOD_PATH = "/grpc.reflection.v1alpha.ServerReflection/ListServices";
/** Method path for the FileContainingSymbol reflection method */
export declare const FILE_CONTAINING_SYMBOL_PATH = "/grpc.reflection.v1alpha.ServerReflection/FileContainingSymbol";
/** Information about a registered service */
export interface ServiceInfo {
    name: string;
    methods: string[];
}
/** Response from ListServices */
export interface ListServicesResponse {
    services: ServiceInfo[];
}
/** Request for fileContainingSymbol */
export interface FileContainingSymbolRequest {
    symbol: string;
}
/** Response from fileContainingSymbol */
export interface FileContainingSymbolResponse {
    fileDescriptorProto: string;
}
/** Parsed field information */
export interface FieldInfo {
    name: string;
    number: number;
    type: string;
    typeName?: string;
    label: string;
    defaultValue?: string;
    jsonName?: string;
}
/** Parsed message information */
export interface MessageInfo {
    name: string;
    fullName: string;
    fields: FieldInfo[];
    nestedTypes: MessageInfo[];
    enumTypes: EnumInfo[];
}
/** Parsed enum information */
export interface EnumInfo {
    name: string;
    fullName: string;
    values: {
        name: string;
        number: number;
    }[];
}
/** Parsed service information from FileDescriptor */
export interface ServiceDescriptor {
    name: string;
    fullName: string;
    methods: MethodDescriptor[];
}
/** Parsed method information */
export interface MethodDescriptor {
    name: string;
    inputType: string;
    outputType: string;
    clientStreaming: boolean;
    serverStreaming: boolean;
}
/** Parsed FileDescriptor */
export interface FileDescriptor {
    name: string;
    package: string;
    services: ServiceDescriptor[];
    messages: MessageInfo[];
    enums: EnumInfo[];
    dependencies: string[];
}
/**
 * Parse a base64-encoded FileDescriptorProto
 *
 * FileDescriptorProto field numbers:
 *   1: name (string)
 *   2: package (string)
 *   3: dependency (repeated string)
 *   4: message_type (repeated DescriptorProto)
 *   5: enum_type (repeated EnumDescriptorProto)
 *   6: service (repeated ServiceDescriptorProto)
 */
export declare function parseFileDescriptor(base64Proto: string): FileDescriptor;
/**
 * Get field information for a specific message type
 *
 * @param fileDescriptor - Parsed file descriptor
 * @param messageName - Message name (can be simple name or full name)
 * @returns Field information array or undefined if message not found
 */
export declare function getFieldInfo(fileDescriptor: FileDescriptor, messageName: string): FieldInfo[] | undefined;
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
     * Get the FileDescriptor containing a specific symbol
     *
     * @param symbol - Fully qualified symbol name (e.g., "mypackage.MyService")
     * @param options - Call options (timeout, headers)
     * @returns Promise resolving to the FileContainingSymbolResponse with base64-encoded FileDescriptorProto
     */
    fileContainingSymbol(symbol: string, options?: CallOptions): Promise<FileContainingSymbolResponse>;
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