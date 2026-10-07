#!/usr/bin/env node
/**
 * Gera um par de chaves VAPID para Web Push.
 *
 * Uso:
 *   npm run vapid:generate
 *
 * Depois, configure no backend (Render → Environment), NUNCA no frontend:
 *   VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 *   VAPID_SUBJECT=mailto:seu-email@seudominio.com
 *
 * A chave PÚBLICA também é devolvida pela API em GET /api/push/public-key.
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("\nChaves VAPID geradas. Guarde a privada em segredo (só no backend):\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:contato@seudominio.com\n");
