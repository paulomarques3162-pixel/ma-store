import { z } from "zod";

/**
 * Contrato publico do endpoint de cotacao do motor proprio.
 * Aceita `cep` (novo) e `destinationZipCode` (compatibilidade).
 */
export const localQuoteRequestSchema = z
  .object({
    cep: z.string().trim().min(1).max(20).optional(),
    destinationZipCode: z.string().trim().min(1).max(20).optional(),
    sessionId: z.string().trim().max(120).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().trim().min(1, "Produto invalido.").max(120),
          quantity: z.coerce.number().int("Quantidade deve ser inteira.").positive("Quantidade deve ser maior que zero.").max(999),
        }),
      )
      .min(1, "Informe ao menos um produto.")
      .max(200),
  })
  .refine((value) => Boolean(value.cep || value.destinationZipCode), {
    message: "Informe o CEP de destino.",
    path: ["cep"],
  });

export type LocalQuoteRequestDto = z.infer<typeof localQuoteRequestSchema>;

/** Simulador administrativo: mesmos campos + opcao de ignorar peso ausente. */
export const localSimulateRequestSchema = localQuoteRequestSchema.and(
  z.object({ allowMissingWeight: z.boolean().optional() }),
);

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export const methodSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da modalidade.").max(120),
  code: z.string().trim().max(40).optional().nullable().or(z.literal("")),
  description: z.string().trim().max(300).optional().nullable().or(z.literal("")),
  active: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  position: z.coerce.number().int().min(0).max(1000).optional(),
});
export const methodUpdateSchema = methodSchema.partial();

export const zoneSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da regiao.").max(120),
  description: z.string().trim().max(300).optional().nullable().or(z.literal("")),
  state: z.string().trim().max(2).optional().nullable().or(z.literal("")),
  zipCodeFrom: z.string().trim().min(8, "Informe o CEP inicial.").max(9),
  zipCodeTo: z.string().trim().min(8, "Informe o CEP final.").max(9),
  active: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
});
export const zoneUpdateSchema = zoneSchema.partial();

export const weightRuleSchema = z.object({
  zoneId: z.string().trim().min(1),
  shippingMethodId: z.string().trim().min(1).nullable().optional(),
  minWeightGrams: z.coerce.number().int("Peso em gramas.").min(0).max(1_000_000),
  maxWeightGrams: z.coerce.number().int("Peso em gramas.").min(0).max(1_000_000),
  price: z.coerce.number().min(0, "O preco nao pode ser negativo."),
  deliveryDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  estimatedMinBusinessDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  estimatedMaxBusinessDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});
export const weightRuleUpdateSchema = weightRuleSchema.partial();

export const cepExceptionSchema = z.object({
  cep: z.string().trim().min(8, "Informe o CEP.").max(9),
  shippingMethodId: z.string().trim().min(1),
  priceOverride: z.coerce.number().min(0).nullable().optional(),
  deliveryDaysOverride: z.coerce.number().int().min(0).max(365).nullable().optional(),
  active: z.boolean().optional(),
});
export const cepExceptionUpdateSchema = cepExceptionSchema.partial();

export const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  originZipCode: z.string().trim().max(9).nullable().optional(),
  packagePaddingGrams: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  defaultHandlingDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  defaultDeliveryDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  freeShippingEnabled: z.boolean().optional(),
  freeShippingMinimumOrderValue: z.coerce.number().min(0).nullable().optional(),
  showEstimateDisclaimer: z.boolean().optional(),
});
