import { describe, it, expect } from 'vitest';
import {
  ReflectionClient,
  REFLECTION_METHOD_PATH,
  type ServiceInfo,
  type ListServicesResponse,
} from '../src/grpc/reflection/reflection';

describe('Reflection', () => {
  describe('Constants', () => {
    it('should have correct method path', () => {
      expect(REFLECTION_METHOD_PATH).toBe(
        '/grpc.reflection.v1alpha.ServerReflection/ListServices'
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
});
