#!/usr/bin/env node
/**
 * Verifica se existe administrador ativo no banco — SEM criar, SEM alterar e
 * SEM exibir credenciais.
 *
 * Uso:
 *   cd backend
 *   DATABASE_URL="<connection string>" node scripts/check-admin.mjs
 *
 * Saída: lista os administradores (e-mail, status, datas) e o código de saída:
 *   0 = existe ao menos um administrador ativo
 *   1 = nenhum administrador ativo (é preciso criar um com o seed)
 *
 * OBS.: nunca imprime senha nem hash — apenas metadados.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      isDemo: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      // passwordHash NUNCA é selecionado aqui de propósito.
    },
    orderBy: { createdAt: "asc" },
  });

  const ativos = admins.filter((admin) => admin.status === "ACTIVE");

  console.log("\n=== MA STORE — verificação de administradores ===\n");

  if (admins.length === 0) {
    console.log("  Nenhum usuário com role=ADMIN encontrado.");
    console.log("\n  Como criar um administrador com segurança (sem apagar nada):");
    console.log("    cd backend");
    console.log("    SEED_ADMIN_EMAIL='voce@seudominio.com.br' \\");
    console.log("    SEED_ADMIN_PASSWORD='<senha-forte-e-unica>' \\");
    console.log("    DATABASE_URL='<connection string>' npm run db:seed\n");
    console.log("  O seed é idempotente: se o e-mail já existir, ele apenas garante o papel ADMIN.");
  } else {
    for (const admin of admins) {
      console.log(`  • ${admin.email}`);
      console.log(`      nome: ${admin.name}`);
      console.log(`      status: ${admin.status}${admin.mustChangePassword ? " (senha deve ser trocada no próximo acesso)" : ""}`);
      console.log(`      conta de demonstração: ${admin.isDemo ? "sim" : "não"}`);
      console.log(`      criado em: ${admin.createdAt.toISOString()}`);
      console.log(`      último acesso: ${admin.lastLoginAt ? admin.lastLoginAt.toISOString() : "nunca"}`);
    }
    console.log(`\n  Total: ${admins.length} administrador(es), ${ativos.length} ativo(s).`);
    console.log("  As senhas não são exibidas: o banco guarda apenas o hash bcrypt.\n");
  }

  process.exit(ativos.length > 0 ? 0 : 1);
} catch (error) {
  console.error("\n[MA STORE] Não foi possível consultar o banco.");
  console.error("Verifique se DATABASE_URL está correto e acessível.\n");
  console.error(String(error instanceof Error ? error.message : error).split("\n")[0]);
  process.exit(2);
} finally {
  await prisma.$disconnect();
}
