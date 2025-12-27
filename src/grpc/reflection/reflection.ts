/**
 * gRPC Server Reflection Client
 *
 * This module provides a client for querying available services
 * from a gRPC server that supports reflection.
 */

import { DataChannelTransport, type CallOptions } from '../transport/datachannel-transport';

/** Method path for the ListServices reflection method */
export const REFLECTION_METHOD_PATH =
  '/grpc.reflection.v1alpha.ServerReflection/ListServices';

/** Method path for the FileContainingSymbol reflection method */
export const FILE_CONTAINING_SYMBOL_PATH =
  '/grpc.reflection.v1alpha.ServerReflection/FileContainingSymbol';

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
  fileDescriptorProto: string; // base64 encoded
}

/** Parsed field information */
export interface FieldInfo {
  name: string;
  number: number;
  type: string;           // "TYPE_STRING", "TYPE_INT32", etc.
  typeName?: string;      // For message/enum types
  label: string;          // "LABEL_OPTIONAL", "LABEL_REPEATED", etc.
  defaultValue?: string;  // Default value if specified
  jsonName?: string;      // JSON field name
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
  values: { name: string; number: number }[];
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

// ============================================================================
// Protobuf Wire Format Decoder
// ============================================================================

/** Wire types in protobuf encoding */
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;

/** Field type names mapping */
const FIELD_TYPE_NAMES: { [key: number]: string } = {
  1: 'TYPE_DOUBLE',
  2: 'TYPE_FLOAT',
  3: 'TYPE_INT64',
  4: 'TYPE_UINT64',
  5: 'TYPE_INT32',
  6: 'TYPE_FIXED64',
  7: 'TYPE_FIXED32',
  8: 'TYPE_BOOL',
  9: 'TYPE_STRING',
  10: 'TYPE_GROUP',
  11: 'TYPE_MESSAGE',
  12: 'TYPE_BYTES',
  13: 'TYPE_UINT32',
  14: 'TYPE_ENUM',
  15: 'TYPE_SFIXED32',
  16: 'TYPE_SFIXED64',
  17: 'TYPE_SINT32',
  18: 'TYPE_SINT64',
};

/** Field label names mapping */
const FIELD_LABEL_NAMES: { [key: number]: string } = {
  1: 'LABEL_OPTIONAL',
  2: 'LABEL_REQUIRED',
  3: 'LABEL_REPEATED',
};

/**
 * Decode a varint from a buffer at the given offset
 * @returns [value, newOffset]
 */
function decodeVarint(buffer: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let currentOffset = offset;

  while (currentOffset < buffer.length) {
    const byte = buffer[currentOffset];
    result |= (byte & 0x7f) << shift;
    currentOffset++;

    if ((byte & 0x80) === 0) {
      return [result, currentOffset];
    }

    shift += 7;
    if (shift > 35) {
      throw new Error('Varint too long');
    }
  }

  throw new Error('Unexpected end of buffer while decoding varint');
}

/**
 * Read a length-delimited field from the buffer
 * @returns [data, newOffset]
 */
function readLengthDelimited(buffer: Uint8Array, offset: number): [Uint8Array, number] {
  const [length, newOffset] = decodeVarint(buffer, offset);
  const data = buffer.slice(newOffset, newOffset + length);
  return [data, newOffset + length];
}

/**
 * Parse protobuf binary data into a map of field number to values
 * Values are stored as arrays since fields can be repeated
 */
function parseProtobuf(buffer: Uint8Array): Map<number, unknown[]> {
  const fields = new Map<number, unknown[]>();
  let offset = 0;

  while (offset < buffer.length) {
    const [tag, newOffset] = decodeVarint(buffer, offset);
    offset = newOffset;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    let value: unknown;

    switch (wireType) {
      case WIRE_TYPE_VARINT: {
        const [v, nextOffset] = decodeVarint(buffer, offset);
        value = v;
        offset = nextOffset;
        break;
      }
      case WIRE_TYPE_FIXED64: {
        // Read 8 bytes as fixed64
        value = buffer.slice(offset, offset + 8);
        offset += 8;
        break;
      }
      case WIRE_TYPE_LENGTH_DELIMITED: {
        const [data, nextOffset] = readLengthDelimited(buffer, offset);
        value = data;
        offset = nextOffset;
        break;
      }
      case WIRE_TYPE_FIXED32: {
        // Read 4 bytes as fixed32
        value = buffer.slice(offset, offset + 4);
        offset += 4;
        break;
      }
      default:
        throw new Error(`Unknown wire type: ${wireType}`);
    }

    if (!fields.has(fieldNumber)) {
      fields.set(fieldNumber, []);
    }
    fields.get(fieldNumber)!.push(value);
  }

  return fields;
}

/**
 * Get a string field from parsed protobuf
 */
function getString(fields: Map<number, unknown[]>, fieldNumber: number): string {
  const values = fields.get(fieldNumber);
  if (!values || values.length === 0) {
    return '';
  }
  const data = values[0] as Uint8Array;
  return new TextDecoder().decode(data);
}

/**
 * Get all string values from a repeated field
 */
function getStringArray(fields: Map<number, unknown[]>, fieldNumber: number): string[] {
  const values = fields.get(fieldNumber);
  if (!values) {
    return [];
  }
  return values.map(v => new TextDecoder().decode(v as Uint8Array));
}

/**
 * Get a varint field value
 */
function getVarint(fields: Map<number, unknown[]>, fieldNumber: number, defaultValue = 0): number {
  const values = fields.get(fieldNumber);
  if (!values || values.length === 0) {
    return defaultValue;
  }
  return values[0] as number;
}

/**
 * Get a boolean field value
 */
function getBool(fields: Map<number, unknown[]>, fieldNumber: number): boolean {
  return getVarint(fields, fieldNumber) !== 0;
}

/**
 * Get all embedded messages from a repeated field
 */
function getMessageArray(fields: Map<number, unknown[]>, fieldNumber: number): Map<number, unknown[]>[] {
  const values = fields.get(fieldNumber);
  if (!values) {
    return [];
  }
  return values.map(v => parseProtobuf(v as Uint8Array));
}

// ============================================================================
// FileDescriptor Parser
// ============================================================================

/**
 * Parse a FieldDescriptorProto
 * Field numbers:
 *   1: name (string)
 *   3: number (int32)
 *   4: label (enum)
 *   5: type (enum)
 *   6: type_name (string) - for message/enum types
 *   7: default_value (string)
 *   10: json_name (string)
 */
function parseFieldDescriptor(fields: Map<number, unknown[]>): FieldInfo {
  const typeNum = getVarint(fields, 5, 0);
  const labelNum = getVarint(fields, 4, 1);

  const field: FieldInfo = {
    name: getString(fields, 1),
    number: getVarint(fields, 3),
    type: FIELD_TYPE_NAMES[typeNum] || `TYPE_UNKNOWN_${typeNum}`,
    label: FIELD_LABEL_NAMES[labelNum] || `LABEL_UNKNOWN_${labelNum}`,
  };

  const typeName = getString(fields, 6);
  if (typeName) {
    field.typeName = typeName;
  }

  const defaultValue = getString(fields, 7);
  if (defaultValue) {
    field.defaultValue = defaultValue;
  }

  const jsonName = getString(fields, 10);
  if (jsonName) {
    field.jsonName = jsonName;
  }

  return field;
}

/**
 * Parse an EnumValueDescriptorProto
 * Field numbers:
 *   1: name (string)
 *   2: number (int32)
 */
function parseEnumValue(fields: Map<number, unknown[]>): { name: string; number: number } {
  return {
    name: getString(fields, 1),
    number: getVarint(fields, 2),
  };
}

/**
 * Parse an EnumDescriptorProto
 * Field numbers:
 *   1: name (string)
 *   2: value (repeated EnumValueDescriptorProto)
 */
function parseEnumDescriptor(fields: Map<number, unknown[]>, packagePrefix: string): EnumInfo {
  const name = getString(fields, 1);
  const fullName = packagePrefix ? `${packagePrefix}.${name}` : name;

  const valueFields = getMessageArray(fields, 2);
  const values = valueFields.map(vf => parseEnumValue(vf));

  return {
    name,
    fullName,
    values,
  };
}

/**
 * Parse a DescriptorProto (message type)
 * Field numbers:
 *   1: name (string)
 *   2: field (repeated FieldDescriptorProto)
 *   3: nested_type (repeated DescriptorProto)
 *   4: enum_type (repeated EnumDescriptorProto)
 */
function parseMessageDescriptor(fields: Map<number, unknown[]>, packagePrefix: string): MessageInfo {
  const name = getString(fields, 1);
  const fullName = packagePrefix ? `${packagePrefix}.${name}` : name;

  const fieldDescs = getMessageArray(fields, 2);
  const parsedFields = fieldDescs.map(fd => parseFieldDescriptor(fd));

  const nestedDescs = getMessageArray(fields, 3);
  const nestedTypes = nestedDescs.map(nd => parseMessageDescriptor(nd, fullName));

  const enumDescs = getMessageArray(fields, 4);
  const enumTypes = enumDescs.map(ed => parseEnumDescriptor(ed, fullName));

  return {
    name,
    fullName,
    fields: parsedFields,
    nestedTypes,
    enumTypes,
  };
}

/**
 * Parse a MethodDescriptorProto
 * Field numbers:
 *   1: name (string)
 *   2: input_type (string)
 *   3: output_type (string)
 *   5: client_streaming (bool)
 *   6: server_streaming (bool)
 */
function parseMethodDescriptor(fields: Map<number, unknown[]>): MethodDescriptor {
  return {
    name: getString(fields, 1),
    inputType: getString(fields, 2),
    outputType: getString(fields, 3),
    clientStreaming: getBool(fields, 5),
    serverStreaming: getBool(fields, 6),
  };
}

/**
 * Parse a ServiceDescriptorProto
 * Field numbers:
 *   1: name (string)
 *   2: method (repeated MethodDescriptorProto)
 */
function parseServiceDescriptor(fields: Map<number, unknown[]>, packagePrefix: string): ServiceDescriptor {
  const name = getString(fields, 1);
  const fullName = packagePrefix ? `${packagePrefix}.${name}` : name;

  const methodDescs = getMessageArray(fields, 2);
  const methods = methodDescs.map(md => parseMethodDescriptor(md));

  return {
    name,
    fullName,
    methods,
  };
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
export function parseFileDescriptor(base64Proto: string): FileDescriptor {
  // Decode base64 to binary
  const binaryString = atob(base64Proto);
  const buffer = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    buffer[i] = binaryString.charCodeAt(i);
  }

  const fields = parseProtobuf(buffer);

  const name = getString(fields, 1);
  const packageName = getString(fields, 2);
  const dependencies = getStringArray(fields, 3);

  // Parse message types
  const messageDescs = getMessageArray(fields, 4);
  const messages = messageDescs.map(md => parseMessageDescriptor(md, packageName));

  // Parse enum types
  const enumDescs = getMessageArray(fields, 5);
  const enums = enumDescs.map(ed => parseEnumDescriptor(ed, packageName));

  // Parse services
  const serviceDescs = getMessageArray(fields, 6);
  const services = serviceDescs.map(sd => parseServiceDescriptor(sd, packageName));

  return {
    name,
    package: packageName,
    services,
    messages,
    enums,
    dependencies,
  };
}

/**
 * Get field information for a specific message type
 *
 * @param fileDescriptor - Parsed file descriptor
 * @param messageName - Message name (can be simple name or full name)
 * @returns Field information array or undefined if message not found
 */
export function getFieldInfo(
  fileDescriptor: FileDescriptor,
  messageName: string
): FieldInfo[] | undefined {
  // Search helper for nested messages
  function findMessage(messages: MessageInfo[], name: string): MessageInfo | undefined {
    for (const msg of messages) {
      if (msg.name === name || msg.fullName === name) {
        return msg;
      }
      // Search in nested types
      const nested = findMessage(msg.nestedTypes, name);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const message = findMessage(fileDescriptor.messages, messageName);
  return message?.fields;
}

/**
 * Reflection client for querying available services
 */
export class ReflectionClient {
  private transport: DataChannelTransport;

  constructor(transport: DataChannelTransport) {
    this.transport = transport;
  }

  /**
   * List all available services on the server
   *
   * @param options - Call options (timeout, headers)
   * @returns Promise resolving to the list of services
   */
  async listServices(options?: CallOptions): Promise<ListServicesResponse> {
    const response = await this.transport.unary<Uint8Array, ListServicesResponse>(
      REFLECTION_METHOD_PATH,
      new Uint8Array(0), // Empty request
      (msg) => msg, // Pass through
      (data) => {
        // Parse JSON response
        const text = new TextDecoder().decode(data);
        return JSON.parse(text) as ListServicesResponse;
      },
      options
    );

    return response.message;
  }

  /**
   * Get the FileDescriptor containing a specific symbol
   *
   * @param symbol - Fully qualified symbol name (e.g., "mypackage.MyService")
   * @param options - Call options (timeout, headers)
   * @returns Promise resolving to the FileContainingSymbolResponse with base64-encoded FileDescriptorProto
   */
  async fileContainingSymbol(
    symbol: string,
    options?: CallOptions
  ): Promise<FileContainingSymbolResponse> {
    const request: FileContainingSymbolRequest = { symbol };
    const requestBody = new TextEncoder().encode(JSON.stringify(request));

    const response = await this.transport.unary<Uint8Array, FileContainingSymbolResponse>(
      FILE_CONTAINING_SYMBOL_PATH,
      requestBody,
      (msg) => msg, // Pass through
      (data) => {
        // Parse JSON response
        const text = new TextDecoder().decode(data);
        return JSON.parse(text) as FileContainingSymbolResponse;
      },
      options
    );

    return response.message;
  }

  /**
   * Get the full method path for a method
   *
   * @param serviceName - Service name (e.g., "mypackage.MyService")
   * @param methodName - Method name (e.g., "GetUser")
   * @returns Full method path (e.g., "/mypackage.MyService/GetUser")
   */
  static getMethodPath(serviceName: string, methodName: string): string {
    return `/${serviceName}/${methodName}`;
  }
}
