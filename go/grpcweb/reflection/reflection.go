// Package reflection provides gRPC Server Reflection support.
//
// This is a simplified implementation that allows clients to query
// available services and methods from the server. It does not use
// protobuf file descriptors; instead, it returns a list of registered
// method paths.
//
// # Usage
//
//	transport := grpcweb.NewTransport(dataChannel, nil)
//	reflection := reflection.New(transport)
//	reflection.Register()
//
//	// Register your handlers
//	transport.RegisterHandler("/mypackage.MyService/MyMethod", handler)
//
//	transport.Start()
package reflection

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sort"
	"strings"
	"sync"

	"github.com/anthropics/cf-wbrtc-auth/go/grpcweb/codec"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// MethodPath is the path for the ListServices method
const MethodPath = "/grpc.reflection.v1alpha.ServerReflection/ListServices"

// FileContainingSymbolPath is the path for the FileContainingSymbol method
const FileContainingSymbolPath = "/grpc.reflection.v1alpha.ServerReflection/FileContainingSymbol"

// ServiceInfo contains information about a registered service
type ServiceInfo struct {
	Name    string   `json:"name"`
	Methods []string `json:"methods"`
}

// ListServicesResponse is the response for ListServices
type ListServicesResponse struct {
	Services []ServiceInfo `json:"services"`
}

// FileContainingSymbolRequest is the request for FileContainingSymbol
type FileContainingSymbolRequest struct {
	Symbol string `json:"symbol"`
}

// FileContainingSymbolResponse is the response for FileContainingSymbol
type FileContainingSymbolResponse struct {
	FileDescriptorProto string `json:"fileDescriptorProto"` // base64 encoded
}

// HandlerRegistry is an interface for getting registered handlers
type HandlerRegistry interface {
	// GetRegisteredMethods returns all registered method paths
	GetRegisteredMethods() []string
}

// Reflection provides server reflection functionality
type Reflection struct {
	registry HandlerRegistry
	mu       sync.RWMutex
}

// New creates a new Reflection instance
func New(registry HandlerRegistry) *Reflection {
	return &Reflection{
		registry: registry,
	}
}

// ListServices returns information about all registered services
func (r *Reflection) ListServices() *ListServicesResponse {
	methods := r.registry.GetRegisteredMethods()

	// Group methods by service
	serviceMap := make(map[string][]string)

	for _, method := range methods {
		// Skip reflection service itself
		if strings.HasPrefix(method, "/grpc.reflection.") {
			continue
		}

		// Parse method path: /package.Service/Method
		parts := strings.Split(strings.TrimPrefix(method, "/"), "/")
		if len(parts) != 2 {
			continue
		}

		serviceName := parts[0]
		methodName := parts[1]

		serviceMap[serviceName] = append(serviceMap[serviceName], methodName)
	}

	// Convert to response
	services := make([]ServiceInfo, 0, len(serviceMap))
	for name, methods := range serviceMap {
		sort.Strings(methods)
		services = append(services, ServiceInfo{
			Name:    name,
			Methods: methods,
		})
	}

	// Sort services by name for consistent output
	sort.Slice(services, func(i, j int) bool {
		return services[i].Name < services[j].Name
	})

	return &ListServicesResponse{
		Services: services,
	}
}

// Handler returns a gRPC handler for the ListServices method
func (r *Reflection) Handler() func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
	return func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		resp := r.ListServices()

		// Simple JSON encoding (avoiding external dependencies)
		data := encodeListServicesResponse(resp)

		return &codec.ResponseEnvelope{
			Headers:  map[string]string{"content-type": "application/json"},
			Messages: [][]byte{data},
			Trailers: map[string]string{"grpc-status": "0"},
		}, nil
	}
}

// FileContainingSymbol returns the FileDescriptorProto for a given symbol name.
// The symbol can be a fully qualified service name (e.g., "mypackage.MyService")
// or a method name (e.g., "mypackage.MyService.MyMethod").
func (r *Reflection) FileContainingSymbol(symbol string) (*FileContainingSymbolResponse, error) {
	// Find the descriptor by name in the global registry
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(symbol))
	if err != nil {
		return nil, err
	}

	// Get the parent file descriptor
	fileDesc := desc.ParentFile()
	if fileDesc == nil {
		return nil, protoregistry.NotFound
	}

	// Convert to FileDescriptorProto
	fileDescProto := protodesc.ToFileDescriptorProto(fileDesc)

	// Serialize to bytes
	data, err := proto.Marshal(fileDescProto)
	if err != nil {
		return nil, err
	}

	// Base64 encode
	encoded := base64.StdEncoding.EncodeToString(data)

	return &FileContainingSymbolResponse{
		FileDescriptorProto: encoded,
	}, nil
}

// FileContainingSymbolHandler returns a gRPC handler for the FileContainingSymbol method
func (r *Reflection) FileContainingSymbolHandler() func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
	return func(ctx context.Context, req *codec.RequestEnvelope) (*codec.ResponseEnvelope, error) {
		// Parse request JSON
		var request FileContainingSymbolRequest
		if len(req.Message) > 0 {
			if err := json.Unmarshal(req.Message, &request); err != nil {
				return &codec.ResponseEnvelope{
					Headers:  map[string]string{"content-type": "application/json"},
					Messages: [][]byte{[]byte(`{"error":"invalid request"}`)},
					Trailers: map[string]string{
						"grpc-status":  "3", // InvalidArgument
						"grpc-message": "invalid request JSON",
					},
				}, nil
			}
		}

		if request.Symbol == "" {
			return &codec.ResponseEnvelope{
				Headers:  map[string]string{"content-type": "application/json"},
				Messages: [][]byte{[]byte(`{"error":"symbol is required"}`)},
				Trailers: map[string]string{
					"grpc-status":  "3", // InvalidArgument
					"grpc-message": "symbol is required",
				},
			}, nil
		}

		// Get file descriptor
		resp, err := r.FileContainingSymbol(request.Symbol)
		if err != nil {
			if err == protoregistry.NotFound {
				return &codec.ResponseEnvelope{
					Headers:  map[string]string{"content-type": "application/json"},
					Messages: [][]byte{[]byte(`{"error":"symbol not found"}`)},
					Trailers: map[string]string{
						"grpc-status":  "5", // NotFound
						"grpc-message": "symbol not found: " + request.Symbol,
					},
				}, nil
			}
			return &codec.ResponseEnvelope{
				Headers:  map[string]string{"content-type": "application/json"},
				Messages: [][]byte{[]byte(`{"error":"internal error"}`)},
				Trailers: map[string]string{
					"grpc-status":  "13", // Internal
					"grpc-message": "internal error: " + err.Error(),
				},
			}, nil
		}

		// Encode response
		data, err := json.Marshal(resp)
		if err != nil {
			return &codec.ResponseEnvelope{
				Headers:  map[string]string{"content-type": "application/json"},
				Messages: [][]byte{[]byte(`{"error":"failed to encode response"}`)},
				Trailers: map[string]string{
					"grpc-status":  "13", // Internal
					"grpc-message": "failed to encode response",
				},
			}, nil
		}

		return &codec.ResponseEnvelope{
			Headers:  map[string]string{"content-type": "application/json"},
			Messages: [][]byte{data},
			Trailers: map[string]string{"grpc-status": "0"},
		}, nil
	}
}

// encodeListServicesResponse encodes the response to JSON
func encodeListServicesResponse(resp *ListServicesResponse) []byte {
	// Manual JSON encoding to avoid importing encoding/json
	var sb strings.Builder
	sb.WriteString(`{"services":[`)

	for i, svc := range resp.Services {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(`{"name":"`)
		sb.WriteString(escapeJSON(svc.Name))
		sb.WriteString(`","methods":[`)

		for j, method := range svc.Methods {
			if j > 0 {
				sb.WriteString(",")
			}
			sb.WriteString(`"`)
			sb.WriteString(escapeJSON(method))
			sb.WriteString(`"`)
		}
		sb.WriteString("]}")
	}

	sb.WriteString("]}")
	return []byte(sb.String())
}

// escapeJSON escapes special characters for JSON strings
func escapeJSON(s string) string {
	var sb strings.Builder
	for _, r := range s {
		switch r {
		case '"':
			sb.WriteString(`\"`)
		case '\\':
			sb.WriteString(`\\`)
		case '\n':
			sb.WriteString(`\n`)
		case '\r':
			sb.WriteString(`\r`)
		case '\t':
			sb.WriteString(`\t`)
		default:
			sb.WriteRune(r)
		}
	}
	return sb.String()
}
