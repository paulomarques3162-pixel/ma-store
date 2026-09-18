/**
 * Executado UMA vez antes de toda a suite.
 * Garante que o banco de testes esta com as migrations aplicadas.
 */
import { execSync } from "node:child_process";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://mastore:devpassword@127.0.0.1:5432/mastore_test?schema=public";

export default function globalSetup() {
  // Nunca rodar a suite de testes contra o banco de desenvolvimento!
  if (TEST_DATABASE_URL.includes("mastore_dev")) {
    throw new Error("TEST_DATABASE_URL aponta para o banco de desenvolvimento. Abortando.");
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
