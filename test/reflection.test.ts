import { describe, it, expect } from 'vitest';
import {
  ReflectionClient,
  REFLECTION_METHOD_PATH,
  FILE_CONTAINING_SYMBOL_PATH,
  parseFileDescriptor,
  getFieldInfo,
  type ServiceInfo,
  type ListServicesResponse,
  type FileContainingSymbolResponse,
  type FileDescriptor,
  type FieldInfo,
} from '../src/grpc/reflection/reflection';

describe('Reflection', () => {
  describe('Constants', () => {
    it('should have correct method path for ListServices', () => {
      expect(REFLECTION_METHOD_PATH).toBe(
        '/grpc.reflection.v1alpha.ServerReflection/ListServices'
      );
    });

    it('should have correct method path for FileContainingSymbol', () => {
      expect(FILE_CONTAINING_SYMBOL_PATH).toBe(
        '/grpc.reflection.v1alpha.ServerReflection/FileContainingSymbol'
      );
    });
  });

  describe('ReflectionClient.getMethodPath', () => {
    it('should format method path correctly', () => {
      expect(ReflectionClient.getMethodPath('mypackage.MyService', 'GetUser')).toBe(
        '/mypackage.MyService/GetUser'
      );
    });

    it('should handle nested package names', () => {
      expect(
        ReflectionClient.getMethodPath('com.example.users.UserService', 'ListUsers')
      ).toBe('/com.example.users.UserService/ListUsers');
    });
  });

  describe('Response parsing', () => {
    it('should parse empty services response', () => {
      const json = '{"services":[]}';
      const response: ListServicesResponse = JSON.parse(json);

      expect(response.services).toHaveLength(0);
    });

    it('should parse single service response', () => {
      const json = JSON.stringify({
        services: [
          {
            name: 'test.TestService',
            methods: ['GetUser', 'UpdateUser'],
          },
        ],
      });
      const response: ListServicesResponse = JSON.parse(json);

      expect(response.services).toHaveLength(1);
      expect(response.services[0].name).toBe('test.TestService');
      expect(response.services[0].methods).toEqual(['GetUser', 'UpdateUser']);
    });

    it('should parse multiple services response', () => {
      const json = JSON.stringify({
        services: [
          { name: 'orders.OrderService', methods: ['CreateOrder', 'GetOrder'] },
          { name: 'users.UserService', methods: ['GetUser', 'UpdateUser'] },
        ],
      });
      const response: ListServicesResponse = JSON.parse(json);

      expect(response.services).toHaveLength(2);
      expect(response.services[0].name).toBe('orders.OrderService');
      expect(response.services[1].name).toBe('users.UserService');
    });
  });

  describe('ServiceInfo type', () => {
    it('should match expected structure', () => {
      const service: ServiceInfo = {
        name: 'test.Service',
        methods: ['Method1', 'Method2'],
      };

      expect(service.name).toBe('test.Service');
      expect(service.methods).toHaveLength(2);
    });
  });

  describe('FileContainingSymbol', () => {
    it('should parse FileContainingSymbolResponse', () => {
      const json = JSON.stringify({
        fileDescriptorProto: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
      });
      const response: FileContainingSymbolResponse = JSON.parse(json);

      expect(response.fileDescriptorProto).toBe('SGVsbG8gV29ybGQ=');
    });
  });

  describe('parseFileDescriptor', () => {
    // Test with a minimal FileDescriptorProto
    // This is a hand-crafted protobuf encoding:
    // - Field 1 (name): "test.proto"
    // - Field 2 (package): "testpkg"
    it('should parse minimal FileDescriptor', () => {
      // Manually encoded FileDescriptorProto:
      // 0x0a = field 1, wire type 2 (length-delimited)
      // 0x0a = length 10
      // "test.proto" = 74 65 73 74 2e 70 72 6f 74 6f
      // 0x12 = field 2, wire type 2
      // 0x07 = length 7
      // "testpkg" = 74 65 73 74 70 6b 67
      const bytes = new Uint8Array([
        0x0a, 0x0a, 0x74, 0x65, 0x73, 0x74, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, // field 1: "test.proto"
        0x12, 0x07, 0x74, 0x65, 0x73, 0x74, 0x70, 0x6b, 0x67, // field 2: "testpkg"
      ]);

      // Convert to base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const fd = parseFileDescriptor(base64);

      expect(fd.name).toBe('test.proto');
      expect(fd.package).toBe('testpkg');
      expect(fd.services).toHaveLength(0);
      expect(fd.messages).toHaveLength(0);
      expect(fd.enums).toHaveLength(0);
      expect(fd.dependencies).toHaveLength(0);
    });

    it('should parse FileDescriptor with service', () => {
      // Build the protobuf manually with correct lengths
      // MethodDescriptorProto:
      //   Field 1 (name): "Hello" = 0x0a, 0x05, H, e, l, l, o (7 bytes)
      //   Field 2 (input_type): ".pkg.Req" = 0x12, 0x08, ., p, k, g, ., R, e, q (10 bytes)
      //   Field 3 (output_type): ".pkg.Res" = 0x1a, 0x08, ., p, k, g, ., R, e, s (10 bytes)
      // Total MethodDescriptorProto: 27 bytes
      const methodProto = new Uint8Array([
        0x0a, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f, // name = "Hello"
        0x12, 0x08, 0x2e, 0x70, 0x6b, 0x67, 0x2e, 0x52, 0x65, 0x71, // input_type = ".pkg.Req"
        0x1a, 0x08, 0x2e, 0x70, 0x6b, 0x67, 0x2e, 0x52, 0x65, 0x73, // output_type = ".pkg.Res"
      ]);

      // ServiceDescriptorProto:
      //   Field 1 (name): "Svc" = 0x0a, 0x03, S, v, c (5 bytes)
      //   Field 2 (method): methodProto wrapped = 0x12, 0x1b (length 27), ... (29 bytes)
      // Total ServiceDescriptorProto: 34 bytes
      const serviceProto = new Uint8Array([
        0x0a, 0x03, 0x53, 0x76, 0x63, // name = "Svc"
        0x12, 0x1b, ...methodProto, // method
      ]);

      // FileDescriptorProto:
      //   Field 1 (name): "a.proto" = 0x0a, 0x07, a, ., p, r, o, t, o (9 bytes)
      //   Field 2 (package): "pkg" = 0x12, 0x03, p, k, g (5 bytes)
      //   Field 6 (service): serviceProto wrapped = 0x32, 0x22 (length 34), ... (36 bytes)
      const bytes = new Uint8Array([
        0x0a, 0x07, 0x61, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, // name = "a.proto"
        0x12, 0x03, 0x70, 0x6b, 0x67, // package = "pkg"
        0x32, 0x22, ...serviceProto, // service
      ]);

      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const fd = parseFileDescriptor(base64);

      expect(fd.name).toBe('a.proto');
      expect(fd.package).toBe('pkg');
      expect(fd.services).toHaveLength(1);
      expect(fd.services[0].name).toBe('Svc');
      expect(fd.services[0].fullName).toBe('pkg.Svc');
      expect(fd.services[0].methods).toHaveLength(1);
      expect(fd.services[0].methods[0].name).toBe('Hello');
      expect(fd.services[0].methods[0].inputType).toBe('.pkg.Req');
      expect(fd.services[0].methods[0].outputType).toBe('.pkg.Res');
      expect(fd.services[0].methods[0].clientStreaming).toBe(false);
      expect(fd.services[0].methods[0].serverStreaming).toBe(false);
    });

    it('should parse FileDescriptor with message', () => {
      // FileDescriptorProto with:
      // - name: "msg.proto"
      // - package: "test"
      // - message_type: { name: "Person", field: [{ name: "name", number: 1, type: 9 (STRING), label: 1 (OPTIONAL) }] }
      const bytes = new Uint8Array([
        // Field 1: name = "msg.proto"
        0x0a, 0x09, 0x6d, 0x73, 0x67, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f,
        // Field 2: package = "test"
        0x12, 0x04, 0x74, 0x65, 0x73, 0x74,
        // Field 4: message_type (DescriptorProto)
        0x22, 0x14,
        // DescriptorProto:
        //   Field 1: name = "Person"
        0x0a, 0x06, 0x50, 0x65, 0x72, 0x73, 0x6f, 0x6e,
        //   Field 2: field (FieldDescriptorProto)
        0x12, 0x0a,
        //   FieldDescriptorProto:
        //     Field 1: name = "name"
        0x0a, 0x04, 0x6e, 0x61, 0x6d, 0x65,
        //     Field 3: number = 1
        0x18, 0x01,
        //     Field 5: type = 9 (TYPE_STRING)
        0x28, 0x09,
      ]);

      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const fd = parseFileDescriptor(base64);

      expect(fd.name).toBe('msg.proto');
      expect(fd.package).toBe('test');
      expect(fd.messages).toHaveLength(1);
      expect(fd.messages[0].name).toBe('Person');
      expect(fd.messages[0].fullName).toBe('test.Person');
      expect(fd.messages[0].fields).toHaveLength(1);
      expect(fd.messages[0].fields[0].name).toBe('name');
      expect(fd.messages[0].fields[0].number).toBe(1);
      expect(fd.messages[0].fields[0].type).toBe('TYPE_STRING');
    });
  });

  describe('getFieldInfo', () => {
    it('should find field info by message name', () => {
      const fd: FileDescriptor = {
        name: 'test.proto',
        package: 'pkg',
        services: [],
        messages: [
          {
            name: 'User',
            fullName: 'pkg.User',
            fields: [
              { name: 'id', number: 1, type: 'TYPE_INT32', label: 'LABEL_OPTIONAL' },
              { name: 'email', number: 2, type: 'TYPE_STRING', label: 'LABEL_OPTIONAL' },
            ],
            nestedTypes: [],
            enumTypes: [],
          },
        ],
        enums: [],
        dependencies: [],
      };

      const fields = getFieldInfo(fd, 'User');
      expect(fields).toHaveLength(2);
      expect(fields![0].name).toBe('id');
      expect(fields![1].name).toBe('email');
    });

    it('should find field info by full message name', () => {
      const fd: FileDescriptor = {
        name: 'test.proto',
        package: 'pkg',
        services: [],
        messages: [
          {
            name: 'User',
            fullName: 'pkg.User',
            fields: [{ name: 'id', number: 1, type: 'TYPE_INT32', label: 'LABEL_OPTIONAL' }],
            nestedTypes: [],
            enumTypes: [],
          },
        ],
        enums: [],
        dependencies: [],
      };

      const fields = getFieldInfo(fd, 'pkg.User');
      expect(fields).toHaveLength(1);
      expect(fields![0].name).toBe('id');
    });

    it('should return undefined for unknown message', () => {
      const fd: FileDescriptor = {
        name: 'test.proto',
        package: 'pkg',
        services: [],
        messages: [],
        enums: [],
        dependencies: [],
      };

      const fields = getFieldInfo(fd, 'Unknown');
      expect(fields).toBeUndefined();
    });

    it('should find nested message types', () => {
      const fd: FileDescriptor = {
        name: 'test.proto',
        package: 'pkg',
        services: [],
        messages: [
          {
            name: 'Outer',
            fullName: 'pkg.Outer',
            fields: [],
            nestedTypes: [
              {
                name: 'Inner',
                fullName: 'pkg.Outer.Inner',
                fields: [{ name: 'value', number: 1, type: 'TYPE_STRING', label: 'LABEL_OPTIONAL' }],
                nestedTypes: [],
                enumTypes: [],
              },
            ],
            enumTypes: [],
          },
        ],
        enums: [],
        dependencies: [],
      };

      const fields = getFieldInfo(fd, 'pkg.Outer.Inner');
      expect(fields).toHaveLength(1);
      expect(fields![0].name).toBe('value');
    });
  });
});
