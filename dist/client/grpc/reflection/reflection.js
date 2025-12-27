/**
 * gRPC Server Reflection Client
 *
 * This module provides a client for querying available services
 * from a gRPC server that supports reflection.
 */
/** Method path for the ListServices reflection method */
export const REFLECTION_METHOD_PATH = '/grpc.reflection.v1alpha.ServerReflection/ListServices';
/** Method path for the FileContainingSymbol reflection method */
export const FILE_CONTAINING_SYMBOL_PATH = '/grpc.reflection.v1alpha.ServerReflection/FileContainingSymbol';
// ============================================================================
// Protobuf Wire Format Decoder
// ============================================================================
/** Wire types in protobuf encoding */
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;
/** Field type names mapping */
const FIELD_TYPE_NAMES = {
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
const FIELD_LABEL_NAMES = {
    1: 'LABEL_OPTIONAL',
    2: 'LABEL_REQUIRED',
    3: 'LABEL_REPEATED',
};
/**
 * Decode a varint from a buffer at the given offset
 * @returns [value, newOffset]
 */
function decodeVarint(buffer, offset) {
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
function readLengthDelimited(buffer, offset) {
    const [length, newOffset] = decodeVarint(buffer, offset);
    const data = buffer.slice(newOffset, newOffset + length);
    return [data, newOffset + length];
}
/**
 * Parse protobuf binary data into a map of field number to values
 * Values are stored as arrays since fields can be repeated
 */
function parseProtobuf(buffer) {
    const fields = new Map();
    let offset = 0;
    while (offset < buffer.length) {
        const [tag, newOffset] = decodeVarint(buffer, offset);
        offset = newOffset;
        const fieldNumber = tag >> 3;
        const wireType = tag & 0x07;
        let value;
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
        fields.get(fieldNumber).push(value);
    }
    return fields;
}
/**
 * Get a string field from parsed protobuf
 */
function getString(fields, fieldNumber) {
    const values = fields.get(fieldNumber);
    if (!values || values.length === 0) {
        return '';
    }
    const data = values[0];
    return new TextDecoder().decode(data);
}
/**
 * Get all string values from a repeated field
 */
function getStringArray(fields, fieldNumber) {
    const values = fields.get(fieldNumber);
    if (!values) {
        return [];
    }
    return values.map(v => new TextDecoder().decode(v));
}
/**
 * Get a varint field value
 */
function getVarint(fields, fieldNumber, defaultValue = 0) {
    const values = fields.get(fieldNumber);
    if (!values || values.length === 0) {
        return defaultValue;
    }
    return values[0];
}
/**
 * Get a boolean field value
 */
function getBool(fields, fieldNumber) {
    return getVarint(fields, fieldNumber) !== 0;
}
/**
 * Get all embedded messages from a repeated field
 */
function getMessageArray(fields, fieldNumber) {
    const values = fields.get(fieldNumber);
    if (!values) {
        return [];
    }
    return values.map(v => parseProtobuf(v));
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
function parseFieldDescriptor(fields) {
    const typeNum = getVarint(fields, 5, 0);
    const labelNum = getVarint(fields, 4, 1);
    const field = {
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
function parseEnumValue(fields) {
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
function parseEnumDescriptor(fields, packagePrefix) {
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
function parseMessageDescriptor(fields, packagePrefix) {
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
function parseMethodDescriptor(fields) {
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
function parseServiceDescriptor(fields, packagePrefix) {
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
export function parseFileDescriptor(base64Proto) {
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
export function getFieldInfo(fileDescriptor, messageName) {
    // Search helper for nested messages
    function findMessage(messages, name) {
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
     * Get the FileDescriptor containing a specific symbol
     *
     * @param symbol - Fully qualified symbol name (e.g., "mypackage.MyService")
     * @param options - Call options (timeout, headers)
     * @returns Promise resolving to the FileContainingSymbolResponse with base64-encoded FileDescriptorProto
     */
    async fileContainingSymbol(symbol, options) {
        const request = { symbol };
        const requestBody = new TextEncoder().encode(JSON.stringify(request));
        const response = await this.transport.unary(FILE_CONTAINING_SYMBOL_PATH, requestBody, (msg) => msg, // Pass through
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
