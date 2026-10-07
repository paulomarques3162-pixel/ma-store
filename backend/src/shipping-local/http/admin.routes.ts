/**
 * Administracao do Shipping Engine proprio.
 *
 * Montado sob `/api/admin/shipping` (dentro do plugin admin, que ja exige
 * role ADMIN). Toda alteracao grava auditoria e invalida o cache.
 *
 * As rotas legadas de modalidade (`/`, `/:id`, `/reorder`) continuam no modulo
 * `shipping.admin.routes.ts`; aqui ficam as rotas do motor proprio.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { diffFields, writeAudit } from "../../lib/audit.js";
import { created, ok, parse } from "../../lib/http.js";
import { invalidateLocalShippingCache } from "../application/container.js";
import {
  bumpShippingConfigVersion,
  createCepException,
  createMethod,
  createWeightRule,
  createZone,
  deleteCepException,
  deleteMethod,
  deleteWeightRule,
  deleteZone,
  getShippingSettings,
  listCepExceptions,
  listMethods,
  listWeightRules,
  listZones,
  updateCepException,
  updateMethod,
  updateShippingSettings,
  updateWeightRule,
  updateZone,
} from "../application/admin.service.js";
import { handleLocalSimulate } from "./handlers.js";
import {
  cepExceptionSchema,
  cepExceptionUpdateSchema,
  methodSchema,
  methodUpdateSchema,
  settingsSchema,
  weightRuleSchema,
  weightRuleUpdateSchema,
  zoneSchema,
  zoneUpdateSchema,
} from "./schemas.js";

const idParam = z.object({ id: z.string().min(1) });
const listQuery = z.object({
  zoneId: z.string().trim().min(1).optional(),
  cep: z.string().trim().min(1).optional(),
});

async function afterWrite(): Promise<void> {
  invalidateLocalShippingCache();
  try {
    await bumpShippingConfigVersion();
  } catch {
    // A invalidacao em memoria ja cobre a instancia atual.
  }
}

export async function localShippingAdminRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- Configuracoes */
  app.get("/settings", async (_request, reply) => ok(reply, await getShippingSettings()));

  app.put("/settings", async (request, reply) => {
    const input = parse(settingsSchema, request.body);
    const before = await getShippingSettings();
    const updated = await updateShippingSettings(input);
    invalidateLocalShippingCache();

    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_settings_updated",
      entity: "ShippingSettings",
      entityId: "default",
      before,
      after: updated,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  /* --------------------------------------------------------------- Modalidades */
  app.get("/methods", async (_request, reply) => ok(reply, await listMethods()));

  app.post("/methods", async (request, reply) => {
    const input = parse(methodSchema, request.body);
    const method = await createMethod(input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_method_created",
      entity: "ShippingMethod",
      entityId: method.id,
      after: method,
      ip: request.ip,
      requestId: request.id,
    });
    return created(reply, method);
  });

  app.put("/methods/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(methodUpdateSchema, request.body);
    const method = await updateMethod(id, input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_method_updated",
      entity: "ShippingMethod",
      entityId: id,
      after: diffFields({ name: method.name }, input).after,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, method);
  });

  app.delete("/methods/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const result = await deleteMethod(id);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_method_deleted",
      entity: "ShippingMethod",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });

  /* -------------------------------------------------------------------- Zonas */
  app.get("/zones", async (_request, reply) => ok(reply, await listZones()));

  app.post("/zones", async (request, reply) => {
    const input = parse(zoneSchema, request.body);
    const zone = await createZone(input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_zone_created",
      entity: "ShippingZone",
      entityId: zone.id,
      after: zone,
      ip: request.ip,
      requestId: request.id,
    });
    return created(reply, zone);
  });

  app.put("/zones/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(zoneUpdateSchema, request.body);
    const zone = await updateZone(id, input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_zone_updated",
      entity: "ShippingZone",
      entityId: id,
      after: diffFields({ name: zone.name }, input).after,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, zone);
  });

  app.delete("/zones/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const result = await deleteZone(id);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_zone_deleted",
      entity: "ShippingZone",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });

  /* ----------------------------------------------------------- Regras de peso */
  app.get("/rules", async (request, reply) => {
    const query = parse(listQuery, request.query);
    return ok(reply, await listWeightRules(query.zoneId));
  });

  app.post("/rules", async (request, reply) => {
    const input = parse(weightRuleSchema, request.body);
    const rule = await createWeightRule(input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_rule_created",
      entity: "ShippingWeightRule",
      entityId: rule.id,
      after: rule,
      ip: request.ip,
      requestId: request.id,
    });
    return created(reply, rule);
  });

  app.put("/rules/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(weightRuleUpdateSchema, request.body);
    const rule = await updateWeightRule(id, input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_rule_updated",
      entity: "ShippingWeightRule",
      entityId: id,
      after: input,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, rule);
  });

  app.delete("/rules/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const result = await deleteWeightRule(id);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_rule_deleted",
      entity: "ShippingWeightRule",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });

  /* ------------------------------------------------------ Excecoes de CEP */
  app.get("/exceptions", async (request, reply) => {
    const query = parse(listQuery, request.query);
    return ok(reply, await listCepExceptions(query.cep));
  });

  app.post("/exceptions", async (request, reply) => {
    const input = parse(cepExceptionSchema, request.body);
    const exception = await createCepException(input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_cep_exception_created",
      entity: "ShippingCepException",
      entityId: exception.id,
      after: exception,
      ip: request.ip,
      requestId: request.id,
    });
    return created(reply, exception);
  });

  app.put("/exceptions/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(cepExceptionUpdateSchema, request.body);
    const exception = await updateCepException(id, input);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_cep_exception_updated",
      entity: "ShippingCepException",
      entityId: id,
      after: input,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, exception);
  });

  app.delete("/exceptions/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const result = await deleteCepException(id);
    await afterWrite();
    await writeAudit({
      adminId: request.authUser!.id,
      action: "shipping_cep_exception_deleted",
      entity: "ShippingCepException",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });

  /* ---------------------------------------------------------------- Simulador */
  app.post("/simulate", handleLocalSimulate);
}
