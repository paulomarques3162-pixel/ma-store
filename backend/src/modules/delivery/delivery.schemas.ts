import { z } from "zod";
import { DELIVERY_FAILURE_REASONS, DELIVERY_STATUSES } from "../../services/delivery.js";

/** Coordenadas opcionais; validadas quando presentes. */
const latitude = z.coerce.number().min(-90, "Latitude invalida.").max(90, "Latitude invalida.");
const longitude = z.coerce.number().min(-180, "Longitude invalida.").max(180, "Longitude invalida.");
const accuracy = z.coerce.number().min(0).max(100_000).optional();

export const geoFields = {
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  locationAccuracy: accuracy,
};

export const driverListQuery = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
});

export const startDeliverySchema = z.object(geoFields);

export const confirmDeliverySchema = z.object({
  recipientName: z.string().trim().min(2, "Informe quem recebeu.").max(160),
  recipientDocumentLast4: z.string().trim().max(4).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  proofPhotoRef: z.string().trim().max(500).optional().nullable(),
  ...geoFields,
});

export const failDeliverySchema = z.object({
  reason: z.enum(DELIVERY_FAILURE_REASONS),
  notes: z.string().trim().max(500).optional().nullable(),
  ...geoFields,
});

export const assignSchema = z.object({
  pedidoId: z.coerce.number().int().positive(),
  driverId: z.string().trim().min(1),
});

export const reassignSchema = z.object({
  driverId: z.string().trim().min(1),
});

const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data invalida (use AAAA-MM-DD).")
  .optional();

export const deliveryReportQuery = z.object({ from: dateField, to: dateField });

export const adminDeliveryQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(DELIVERY_STATUSES).optional(),
  driverId: z.string().trim().optional(),
});

export const driverCreateSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome.").max(160),
  email: z.string().trim().email("E-mail invalido.").max(200),
  phone: z.string().trim().max(30).optional().nullable(),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(200),
});

export const driverUpdateSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  status: z.enum(["ACTIVE", "BLOCKED", "PENDING"]).optional(),
});

export const driverResetSchema = z.object({
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(200),
});
