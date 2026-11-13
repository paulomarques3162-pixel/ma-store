-- Pedido com entrega/retirada a COMBINAR com a loja.
-- Migração ADITIVA: adiciona uma coluna booleana com default false. Nenhum
-- registro existente é alterado (todos continuam com frete definido).
ALTER TABLE "pedidos" ADD COLUMN "frete_combinar" BOOLEAN NOT NULL DEFAULT false;
