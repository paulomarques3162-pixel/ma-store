/** Item de frete (snapshot do carrinho). */
export type ShippingItem = {
  id: string;
  nome: string;
  quantidade: number;
  /** Peso unitario em KG. */
  peso_unitario: number;
};

/**
 * Opcao de frete no padrao unico consumido pelo frontend.
 * Todas as modalidades (Correios, Flex/Motoboy, Jetlog, Pegaki, Retirada)
 * usam exatamente este formato.
 */
export type ShippingOption = {
  id: string;
  nome: string;
  valor: number;
  prazo: string;
  carrier: string | null;
  descricao: string | null;
  /** true => cliente paga diretamente a transportadora (ex.: Correios). */
  pagoDireto: boolean;
  /** true => valor deve ser somado ao total cobrado pela loja. */
  incluirNoTotal: boolean;
};

export type ShippingQuoteResult = {
  success: boolean;
  cep: string;
  pesoTotal: number;
  options: ShippingOption[];
  /** Avisos nao bloqueantes (ex.: Correios indisponivel). */
  warnings: string[];
  /** true quando o calculo externo falhou e o cliente pode tentar novamente. */
  retryable: boolean;
};
