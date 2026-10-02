/**
 * Contrato OpenAPI 3.0 do Shipping Engine (v1).
 * Pode ser servido em `GET /api/v1/shipping/openapi.json`.
 */
export function buildOpenApiDocument(version = "1.0.0"): Record<string, unknown> {
  const quoteExample = {
    storeId: "loja-123",
    origin: { postalCode: "01310100" },
    destination: { postalCode: "20040020" },
    packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30, quantity: 1 }],
    declaredValue: 199.9,
    orderValue: 250,
    services: ["PAC", "SEDEX"],
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Shipping Engine API",
      version,
      description:
        "API universal de cotação de frete. Recebe CEPs, volumes e serviços; devolve cotações normalizadas de todos os provedores habilitados.",
    },
    servers: [{ url: "/api/v1/shipping" }],
    tags: [{ name: "Shipping" }],
    paths: {
      "/quotes": {
        post: {
          tags: ["Shipping"],
          summary: "Calcula cotações de frete",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteRequest" }, example: quoteExample } },
          },
          responses: {
            "200": {
              description: "Cotações (pode ser vazio quando nenhum provedor atende)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteResponse" } } },
            },
            "400": { description: "Requisição inválida" },
            "422": { description: "CEP, peso ou dimensões inválidos" },
            "503": { description: "Provedor indisponível" },
          },
        },
      },
      "/providers": { get: { tags: ["Shipping"], summary: "Lista provedores", responses: { "200": { description: "OK" } } } },
      "/services": { get: { tags: ["Shipping"], summary: "Lista serviços", responses: { "200": { description: "OK" } } } },
      "/health": { get: { tags: ["Shipping"], summary: "Health-check geral", responses: { "200": { description: "OK" } } } },
      "/providers/{provider}/health": {
        get: {
          tags: ["Shipping"],
          summary: "Health-check de um provedor",
          parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/providers/correios/test": {
        post: { tags: ["Shipping"], summary: "Testa conexão com os Correios", responses: { "200": { description: "OK" } } },
      },
      "/validate": {
        post: {
          tags: ["Shipping"],
          summary: "Valida a requisição sem consultar provedores",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteRequest" } } } },
          responses: { "200": { description: "OK" }, "422": { description: "Inválido" } },
        },
      },
    },
    components: {
      schemas: {
        QuoteRequest: {
          type: "object",
          required: ["storeId", "origin", "destination", "packages"],
          properties: {
            storeId: { type: "string" },
            origin: { type: "object", properties: { postalCode: { type: "string", example: "01310100" } } },
            destination: { type: "object", properties: { postalCode: { type: "string", example: "20040020" } } },
            packages: {
              type: "array",
              items: {
                type: "object",
                required: ["weightGrams", "heightCm", "widthCm", "lengthCm"],
                properties: {
                  weightGrams: { type: "integer", example: 1000 },
                  heightCm: { type: "number", example: 10 },
                  widthCm: { type: "number", example: 20 },
                  lengthCm: { type: "number", example: 30 },
                  quantity: { type: "integer", example: 1 },
                },
              },
            },
            declaredValue: { type: "number" },
            orderValue: { type: "number" },
            services: { type: "array", items: { type: "string" } },
            currency: { type: "string", example: "BRL" },
          },
        },
        Quote: {
          type: "object",
          properties: {
            carrier: { type: "string" },
            serviceCode: { type: "string" },
            serviceName: { type: "string" },
            type: { type: "string", enum: ["STANDARD", "EXPRESS", "ECONOMIC", "PICKUP", "LOCAL", "CUSTOM"] },
            price: { type: "number" },
            basePrice: { type: "number" },
            currency: { type: "string" },
            deliveryDays: { type: "integer" },
            estimatedDeliveryDate: { type: "string", nullable: true },
            available: { type: "boolean" },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
        QuoteResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                quotes: { type: "array", items: { $ref: "#/components/schemas/Quote" } },
                warnings: { type: "array", items: { type: "string" } },
                errors: { type: "array", items: { type: "object" } },
                meta: { type: "object" },
              },
            },
          },
        },
      },
    },
  };
}
