import {
  DEFAULT_CUBIC_DIVISOR,
  cubicWeightGrams,
  sumDimensionsCm,
} from "./dimensions.js";
import { invalidDimensions, invalidRequest, invalidWeight } from "./errors.js";

/** Limites de pacote — configuráveis por provedor em etapas futuras. */
export type PackageLimits = {
  minWeightGrams: number;
  maxWeightGrams: number;
  minDimensionCm: number;
  maxDimensionCm: number;
  maxSumDimensionsCm: number;
  maxQuantityPerPackage: number;
  maxPackages: number;
  cubicDivisor: number;
};

export const DEFAULT_PACKAGE_LIMITS: Readonly<PackageLimits> = {
  minWeightGrams: 1,
  maxWeightGrams: 30_000,
  minDimensionCm: 1,
  maxDimensionCm: 200,
  maxSumDimensionsCm: 300,
  maxQuantityPerPackage: 999,
  maxPackages: 50,
  cubicDivisor: DEFAULT_CUBIC_DIVISOR,
};

/** Entrada crua de um volume (vinda da API HTTP). */
export type PackageInput = {
  weightGrams: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  quantity?: number;
};

/** Volume normalizado e enriquecido com pesos cúbico e taxado. */
export type NormalizedPackage = {
  weightGrams: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  quantity: number;
  volumeCm3: number;
  cubicWeightGrams: number;
  /** Peso considerado no cálculo: o maior entre real e cúbico. */
  billedWeightGrams: number;
};

function requirePositive(value: unknown, min: number, max: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : Number.NaN;
}

export function normalizePackage(
  input: PackageInput | null | undefined,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): NormalizedPackage {
  if (!input || typeof input !== "object") {
    throw invalidRequest("Volume inválido.");
  }

  const weight = requirePositive(input.weightGrams, limits.minWeightGrams, limits.maxWeightGrams);
  if (!Number.isFinite(weight)) {
    throw invalidWeight(`Peso deve estar entre ${limits.minWeightGrams}g e ${limits.maxWeightGrams}g.`);
  }

  const height = requirePositive(input.heightCm, limits.minDimensionCm, limits.maxDimensionCm);
  const width = requirePositive(input.widthCm, limits.minDimensionCm, limits.maxDimensionCm);
  const length = requirePositive(input.lengthCm, limits.minDimensionCm, limits.maxDimensionCm);
  if (!Number.isFinite(height) || !Number.isFinite(width) || !Number.isFinite(length)) {
    throw invalidDimensions(
      `Altura, largura e comprimento devem estar entre ${limits.minDimensionCm}cm e ${limits.maxDimensionCm}cm.`,
    );
  }
  if (sumDimensionsCm(height, width, length) > limits.maxSumDimensionsCm) {
    throw invalidDimensions(`A soma das dimensões não pode passar de ${limits.maxSumDimensionsCm}cm.`);
  }

  const quantity = input.quantity === undefined ? 1 : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > limits.maxQuantityPerPackage) {
    throw invalidRequest(`Quantidade por volume deve ser um inteiro entre 1 e ${limits.maxQuantityPerPackage}.`);
  }

  const volumeCm3 = height * width * length;
  const cubic = cubicWeightGrams(height, width, length, limits.cubicDivisor);

  return {
    weightGrams: weight,
    heightCm: height,
    widthCm: width,
    lengthCm: length,
    quantity,
    volumeCm3,
    cubicWeightGrams: cubic,
    billedWeightGrams: Math.max(weight, cubic),
  };
}

export function normalizePackages(
  inputs: readonly PackageInput[] | null | undefined,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): NormalizedPackage[] {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw invalidRequest("Informe ao menos um volume para calcular o frete.");
  }
  if (inputs.length > limits.maxPackages) {
    throw invalidRequest(`No máximo ${limits.maxPackages} volumes por cotação.`);
  }
  return inputs.map((input) => normalizePackage(input, limits));
}

export type PackageSummary = {
  packageCount: number;
  totalQuantity: number;
  totalWeightGrams: number;
  totalCubicWeightGrams: number;
  totalBilledWeightGrams: number;
};

export function summarizePackages(packages: readonly NormalizedPackage[]): PackageSummary {
  return packages.reduce<PackageSummary>(
    (summary, pkg) => ({
      packageCount: summary.packageCount + 1,
      totalQuantity: summary.totalQuantity + pkg.quantity,
      totalWeightGrams: summary.totalWeightGrams + pkg.weightGrams * pkg.quantity,
      totalCubicWeightGrams: summary.totalCubicWeightGrams + pkg.cubicWeightGrams * pkg.quantity,
      totalBilledWeightGrams: summary.totalBilledWeightGrams + pkg.billedWeightGrams * pkg.quantity,
    }),
    {
      packageCount: 0,
      totalQuantity: 0,
      totalWeightGrams: 0,
      totalCubicWeightGrams: 0,
      totalBilledWeightGrams: 0,
    },
  );
}
