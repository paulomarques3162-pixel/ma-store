import { invalidRequest } from "./errors.js";

/**
 * Catálogo normalizado de serviços.
 *
 * Nenhum provedor é consultado por nome solto ("PAC") espalhado pelo código:
 * tudo passa por `{ provider, code, name, type }`.
 */

export const SHIPPING_SERVICE_TYPES = [
  "STANDARD",
  "EXPRESS",
  "ECONOMIC",
  "PICKUP",
  "LOCAL",
  "CUSTOM",
] as const;

export type ShippingServiceType = (typeof SHIPPING_SERVICE_TYPES)[number];

export type ShippingServiceDescriptor = {
  provider: string;
  code: string;
  name: string;
  type: ShippingServiceType;
  description?: string;
};

/** Normaliza um identificador de provedor (" Correios " -> "correios"). */
export function normalizeProviderId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isShippingServiceType(value: unknown): value is ShippingServiceType {
  return typeof value === "string" && (SHIPPING_SERVICE_TYPES as readonly string[]).includes(value);
}

/** Valida e normaliza um descritor de serviço. */
export function defineService(descriptor: ShippingServiceDescriptor): ShippingServiceDescriptor {
  if (!descriptor || typeof descriptor !== "object") {
    throw invalidRequest("Descritor de serviço inválido.");
  }
  const provider = normalizeProviderId(descriptor.provider);
  const code = String(descriptor.code ?? "").trim();
  const name = String(descriptor.name ?? "").trim();
  if (!provider || !code || !name) {
    throw invalidRequest("Serviço precisa de provider, code e name.");
  }
  if (!isShippingServiceType(descriptor.type)) {
    throw invalidRequest(`Tipo de serviço inválido: ${String(descriptor.type)}.`);
  }
  return {
    provider,
    code,
    name,
    type: descriptor.type,
    ...(descriptor.description ? { description: descriptor.description } : {}),
  };
}

export class ShippingServiceCatalog {
  private readonly byProvider = new Map<string, Map<string, ShippingServiceDescriptor>>();

  register(descriptor: ShippingServiceDescriptor): this {
    const normalized = defineService(descriptor);
    const services = this.byProvider.get(normalized.provider) ?? new Map<string, ShippingServiceDescriptor>();
    services.set(normalized.code, normalized);
    this.byProvider.set(normalized.provider, services);
    return this;
  }

  registerMany(descriptors: readonly ShippingServiceDescriptor[]): this {
    for (const descriptor of descriptors) this.register(descriptor);
    return this;
  }

  has(provider: string, code: string): boolean {
    return this.byProvider.get(normalizeProviderId(provider))?.has(code) ?? false;
  }

  get(provider: string, code: string): ShippingServiceDescriptor | undefined {
    return this.byProvider.get(normalizeProviderId(provider))?.get(code);
  }

  listByProvider(provider: string): ShippingServiceDescriptor[] {
    return [...(this.byProvider.get(normalizeProviderId(provider))?.values() ?? [])];
  }

  providers(): string[] {
    return [...this.byProvider.keys()];
  }
}

export function createServiceCatalog(
  descriptors: readonly ShippingServiceDescriptor[] = [],
): ShippingServiceCatalog {
  return new ShippingServiceCatalog().registerMany(descriptors);
}
