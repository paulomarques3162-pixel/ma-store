import { describe, expect, it } from "vitest";
import {
  installNationalTableWithStore,
  type NationalTableStore,
} from "../../../src/shipping-local/bootstrap/install.service";
import { NATIONAL_METHODS, NATIONAL_ZONES, buildZoneRules } from "../../../src/shipping-local/bootstrap/national-table";

class MemoryStore implements NationalTableStore {
  readonly methods = new Map<string, string>();
  readonly zones = new Map<string, string>();
  readonly rules = new Map<string, string>();
  settings = false;
  customZones = 0;
  bumps = 0;
  private methodSeq = 0;
  private zoneSeq = 0;
  private ruleSeq = 0;

  async countCustomZones() {
    return this.customZones;
  }
  async hasSettings() {
    return this.settings;
  }
  async createSettings() {
    this.settings = true;
  }
  async findMethodIdByCode(code: string) {
    return this.methods.get(code) ?? null;
  }
  async createMethod(input: { code: string }) {
    const id = `m${(this.methodSeq += 1)}`;
    this.methods.set(input.code, id);
    return id;
  }
  async findZoneIdBySeedKey(seedKey: string) {
    return this.zones.get(seedKey) ?? null;
  }
  async createZone(input: { seedKey: string }) {
    const id = `z${(this.zoneSeq += 1)}`;
    this.zones.set(input.seedKey, id);
    return id;
  }
  async findRuleIdBySeedKey(seedKey: string) {
    return this.rules.get(seedKey) ?? null;
  }
  async createRule(input: { seedKey: string }) {
    const id = `r${(this.ruleSeq += 1)}`;
    this.rules.set(input.seedKey, id);
    return id;
  }
  async bumpConfigVersion() {
    this.bumps += 1;
  }
}

const EXPECTED_RULES = NATIONAL_ZONES.length * NATIONAL_METHODS.length * 6;

describe("instalador da tabela nacional (idempotente)", () => {
  it("instala modalidades, zonas, regras e configuracoes na primeira execucao", async () => {
    const store = new MemoryStore();
    const result = await installNationalTableWithStore(store);

    expect(result.skipped).toBe(false);
    expect(result.methodsCreated).toBe(NATIONAL_METHODS.length);
    expect(result.zonesCreated).toBe(NATIONAL_ZONES.length);
    expect(result.rulesCreated).toBe(EXPECTED_RULES);
    expect(result.settingsCreated).toBe(true);
    expect(store.methods.size).toBe(NATIONAL_METHODS.length);
    expect(store.zones.size).toBe(NATIONAL_ZONES.length);
    expect(store.rules.size).toBe(EXPECTED_RULES);
    expect(store.bumps).toBe(1);
  });

  it("reexecutar nao duplica nada (idempotente)", async () => {
    const store = new MemoryStore();
    await installNationalTableWithStore(store);
    const second = await installNationalTableWithStore(store);

    expect(second.methodsCreated).toBe(0);
    expect(second.zonesCreated).toBe(0);
    expect(second.rulesCreated).toBe(0);
    expect(second.settingsCreated).toBe(false);
    expect(store.zones.size).toBe(NATIONAL_ZONES.length);
    expect(store.rules.size).toBe(EXPECTED_RULES);
    expect(store.bumps).toBe(1); // nada mudou => nao invalida o cache
  });

  it("preserva zonas/faixas existentes e completa apenas o que falta", async () => {
    const store = new MemoryStore();
    // Simula uma zona inicial ja instalada (com suas 18 regras) e edicoes do admin.
    const zone = NATIONAL_ZONES[0]!;
    store.zones.set(zone.seedKey, "z-existente");
    const existingRules = buildZoneRules(zone);
    for (const { rule } of existingRules) store.rules.set(rule.seedKey, `r-${rule.seedKey}`);
    store.settings = true;

    const result = await installNationalTableWithStore(store);
    expect(result.zonesCreated).toBe(NATIONAL_ZONES.length - 1);
    expect(result.settingsCreated).toBe(false);
    // A zona e suas regras existentes nao sao recriadas; o restante e completado.
    expect(store.zones.get(zone.seedKey)).toBe("z-existente");
    expect(result.rulesCreated).toBe(EXPECTED_RULES - existingRules.length);
    expect(store.rules.size).toBe(EXPECTED_RULES);
  });

  it("nao mistura a tabela inicial quando ha zonas personalizadas do admin", async () => {
    const store = new MemoryStore();
    store.customZones = 2;
    const result = await installNationalTableWithStore(store);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/administrador/i);
    expect(result.customZonesDetected).toBe(2);
    expect(store.zones.size).toBe(0);
    expect(store.rules.size).toBe(0);
  });

  it("com force instala mesmo havendo zonas personalizadas", async () => {
    const store = new MemoryStore();
    store.customZones = 2;
    const result = await installNationalTableWithStore(store, { force: true });

    expect(result.skipped).toBe(false);
    expect(result.zonesCreated).toBe(NATIONAL_ZONES.length);
    expect(result.rulesCreated).toBe(EXPECTED_RULES);
  });
});
