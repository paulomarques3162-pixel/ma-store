import bcrypt from "bcryptjs";

/**
 * Hash de senha.
 *
 * Usamos bcrypt (custo 12). A senha em texto puro NUNCA e persistida, logada
 * ou devolvida em resposta - nem para administradores.
 */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Politica minima de senha aplicada no cadastro e na redefinicao. */
export function validatePasswordStrength(plain: string): { ok: boolean; message?: string } {
  if (plain.length < 8) return { ok: false, message: "A senha deve ter ao menos 8 caracteres." };
  if (!/[A-Za-z]/.test(plain)) return { ok: false, message: "A senha deve conter ao menos uma letra." };
  if (!/\d/.test(plain)) return { ok: false, message: "A senha deve conter ao menos um numero." };
  return { ok: true };
}
