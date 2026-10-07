import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../lib/audit.js";
import { created, ok, parse } from "../../lib/http.js";
import * as drivers from "../../services/drivers.js";
import { driverCreateSchema, driverResetSchema, driverUpdateSchema } from "../delivery/delivery.schemas.js";

const idParam = (params: unknown) => (params as { id: string }).id;

/** Gerenciamento de entregadores (somente ADMIN). */
export async function driverAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async (_request, reply) => ok(reply, { success: true, drivers: await drivers.listDrivers() }));

  app.post("/", async (request, reply) => {
    const input = parse(driverCreateSchema, request.body);
    const driver = await drivers.createDriver(input);
    await writeAudit({
      adminId: request.authUser!.id,
      action: "driver_created",
      entity: "User",
      entityId: driver.id,
      after: { name: driver.name, email: driver.email },
      ip: request.ip,
      requestId: request.id,
    });
    return created(reply, { success: true, driver });
  });

  app.patch("/:id", async (request, reply) => {
    const id = idParam(request.params);
    const input = parse(driverUpdateSchema, request.body);
    const driver = await drivers.updateDriver(id, input);
    await writeAudit({
      adminId: request.authUser!.id,
      action: "driver_updated",
      entity: "User",
      entityId: id,
      after: input,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, { success: true, driver });
  });

  app.post("/:id/deactivate", async (request, reply) => {
    const id = idParam(request.params);
    const driver = await drivers.deactivateDriver(id);
    await writeAudit({
      adminId: request.authUser!.id,
      action: "driver_deactivated",
      entity: "User",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, { success: true, driver });
  });

  app.post("/:id/reset-password", async (request, reply) => {
    const id = idParam(request.params);
    const input = parse(driverResetSchema, request.body);
    const result = await drivers.resetDriverPassword(id, input.password);
    await writeAudit({
      adminId: request.authUser!.id,
      action: "driver_password_reset",
      entity: "User",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });
}
