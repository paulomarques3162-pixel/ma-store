-- Marca de idempotencia do aviso de "produto novo" por Web Push.
--
-- ADITIVA: adiciona apenas uma coluna anulavel. Nenhum dado existente e
-- alterado ou removido e nenhum produto antigo passa a ser notificado
-- retroativamente (`NULL` significa "ainda nao notificado", mas o aviso so e
-- reivindicado em uma transicao real para publicado).
-- Idempotente: pode ser reaplicada sem erro caso ja exista.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP(3);
