import { z } from "zod";

export const shippingPackageSchema = z.object({
  weightGrams: z.coerce.number().positive().max(1_000_000),
  heightCm: z.coerce.number().positive().max(1000),
  widthCm: z.coerce.number().positive().max(1000),
  lengthCm: z.coerce.number().positive().max(1000),
  quantity: z.coerce.number().int().min(1).max(999).optional(),
});

export const shippingQuoteRequestSchema = z.object({
  storeId: z.string().trim().min(1).max(120),
  origin: z.object({ postalCode: z.string().trim().min(1).max(20) }),
  destination: z.object({ postalCode: z.string().trim().min(1).max(20) }),
  packages: z.array(shippingPackageSchema).min(1).max(50),
  declaredValue: z.coerce.number().nonnegative().optional(),
  orderValue: z.coerce.number().nonnegative().optional(),
  services: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  currency: z.string().trim().length(3).optional(),
});

export const providerParamSchema = z.object({ provider: z.string().trim().min(1).max(60) });

export type ShippingQuoteRequestDto = z.infer<typeof shippingQuoteRequestSchema>;
