import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs, Card, ContentPlaceholder, Icon, StoreValue } from "@/components/ui";
import { useContent } from "@/hooks";
import { CONTENT_KEYS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { formatCurrency } from "@/lib/format";

/* ==========================================================================
 * Páginas institucionais
 *
 * Todas usam o conteúdo cadastrado no painel. Quando o administrador ainda não
 * preencheu, exibimos um aviso claro ("ainda não cadastrado") em vez de inventar
 * regras comerciais, prazos ou políticas.
 * ======================================================================== */

/** Contato */
export default function ContactPage() {
  const { get } = useContent();

  useEffect(() => {
    applySeo({
      title: "Contato",
      description: "Fale com a loja por e-mail, telefone ou pela central de mensagens.",
      canonicalPath: "/contato",
    });
  }, []);

  const email = get(CONTENT_KEYS.storeEmail);
  const phone = get(CONTENT_KEYS.storePhone);
  const whatsapp = get(CONTENT_KEYS.storeWhatsapp);
  const address = get(CONTENT_KEYS.storeAddress);
  const hours = get(CONTENT_KEYS.storeHours);
  const hasAnyContact = Boolean(email || phone || whatsapp || address);

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Contato" }]} />

      <div className="page-header">
        <h1 className="page-header__title">Contato</h1>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Card className="stack stack-4">
          <span className="empty-state__icon" style={{ margin: 0 }}>
            <Icon name="messages" size={24} />
          </span>
          <h2 className="text-lg">Central de mensagens</h2>
          <p className="text-sm text-muted">
            A forma mais rápida de falar com a loja. Basta ter uma conta e abrir uma conversa.
          </p>
          <Link to="/mensagens" className="btn btn--primary btn--block">
            <Icon name="send" size={18} /> Abrir mensagens
          </Link>
        </Card>

        <Card className="stack stack-4">
          <span className="empty-state__icon" style={{ margin: 0 }}>
            <Icon name="phone" size={24} />
          </span>
          <h2 className="text-lg">Canais da loja</h2>

          {hasAnyContact ? (
            <div className="site-footer__contact" style={{ color: "var(--color-text)" }}>
              {email ? (
                <a href={`mailto:${email}`} className="row row-2">
                  <Icon name="mail" size={16} /> {email}
                </a>
              ) : null}
              {phone ? (
                <a href={`tel:${phone.replace(/\D/g, "")}`} className="row row-2">
                  <Icon name="phone" size={16} /> {phone}
                </a>
              ) : null}
              {whatsapp ? (
                <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="row row-2">
                  <Icon name="whatsapp" size={16} /> WhatsApp
                </a>
              ) : null}
              {hours ? (
                <span className="row row-2 text-sm text-muted">
                  <Icon name="clock" size={16} /> {hours}
                </span>
              ) : null}
            </div>
          ) : (
            <ContentPlaceholder
              title="Contato ainda não cadastrado"
              text="O administrador precisa preencher e-mail, telefone e endereço no painel (Configurações → Loja)."
              icon="phone"
            />
          )}
        </Card>

        <Card className="stack stack-4">
          <span className="empty-state__icon" style={{ margin: 0 }}>
            <Icon name="mapPin" size={24} />
          </span>
          <h2 className="text-lg">Endereço</h2>
          <p className="text-sm text-muted">
            <StoreValue k={CONTENT_KEYS.storeAddress} fallback="Endereço ainda não cadastrado no painel." />
          </p>
          <StoreValue k={CONTENT_KEYS.storeHours} fallback="" as="p" className="text-xs text-subtle" />
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

/** Como comprar */
export function HowToBuyPage() {
  const { get } = useHowToBuy();

  useEffect(() => {
    applySeo({
      title: "Como comprar",
      description: "Passo a passo para comprar na loja.",
      canonicalPath: "/como-comprar",
    });
  }, []);

  return (
    <div className="container container--narrow">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Como comprar" }]} />

      <div className="page-header">
        <h1 className="page-header__title">Como comprar</h1>
      </div>

      {get ? (
        <div className="prose">
          {get.split("\n").map((paragraph, index) =>
            paragraph.trim() ? <p key={index}>{paragraph}</p> : null,
          )}
        </div>
      ) : (
        <div className="stack stack-6">
          <ContentPlaceholder
            title="Texto “Como comprar” ainda não cadastrado"
            text="O administrador pode escrever o passo a passo no painel (Conteúdo → Páginas)."
            icon="clipboard"
          />

          {/* Passo a passo técnico do fluxo REAL do sistema (não é texto comercial) */}
          <Card className="stack stack-4">
            <h2 className="text-lg">O fluxo da loja, na prática</h2>
            <ol className="prose" style={{ listStyle: "decimal", paddingLeft: "var(--space-5)" }}>
              <li>Crie sua conta em <Link to="/cadastro">Cadastro</Link> — a compra exige uma conta.</li>
              <li>Encontre o produto pela <Link to="/buscar">busca</Link> ou navegue pelas categorias.</li>
              <li>Adicione ao carrinho e ajuste a quantidade.</li>
              <li>No carrinho, aplique um cupom (se houver) e confira o resumo.</li>
              <li>No checkout, informe o endereço e escolha a modalidade de entrega disponível para o seu CEP.</li>
              <li>Escolha a forma de pagamento habilitada pela loja e finalize.</li>
              <li>Acompanhe tudo em <Link to="/meus-pedidos">Meus pedidos</Link> e pelo <Link to="/mensagens">atendimento</Link>.</li>
            </ol>
          </Card>
        </div>
      )}

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

function useHowToBuy() {
  const { get } = useContent();
  return { get: get(CONTENT_KEYS.howToBuy) };
}

/** Trocas e devoluções */
export function ExchangesPage() {
  const { get } = useContent();
  const policy = get(CONTENT_KEYS.policyExchange);

  useEffect(() => {
    applySeo({
      title: "Trocas e devoluções",
      description: "Política de trocas e devoluções da loja.",
      canonicalPath: "/trocas-e-devolucoes",
    });
  }, []);

  return (
    <div className="container container--narrow">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Trocas e devoluções" }]} />

      <div className="page-header">
        <h1 className="page-header__title">Trocas e devoluções</h1>
      </div>

      {policy ? (
        <div className="prose">
          {policy.split("\n").map((paragraph, index) => (paragraph.trim() ? <p key={index}>{paragraph}</p> : null))}
        </div>
      ) : (
        <div className="stack stack-6">
          <ContentPlaceholder
            title="Política ainda não cadastrada"
            text="A loja precisa cadastrar a política de trocas e devoluções no painel (Configurações → Políticas). Este espaço não é preenchido com texto genérico para não criar regras que a loja não definiu."
            icon="refresh"
          />
          <Card className="stack stack-3">
            <h2 className="text-lg">Precisa de ajuda com um pedido?</h2>
            <p className="text-sm text-muted">
              Abra uma conversa informando o número do pedido. O atendimento registra sua solicitação e responde por
              aqui mesmo.
            </p>
            <Link to="/mensagens" className="btn btn--ghost">
              <Icon name="message" size={16} /> Falar com a loja
            </Link>
          </Card>
        </div>
      )}

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

/** Política de privacidade / Termos de uso (mesma estrutura) */
export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { get } = useContent();
  const isPrivacy = kind === "privacy";
  const key = isPrivacy ? CONTENT_KEYS.policyPrivacy : CONTENT_KEYS.policyTerms;
  const text = get(key);
  const title = isPrivacy ? "Política de privacidade" : "Termos de uso";
  const path = isPrivacy ? "/politica-de-privacidade" : "/termos-de-uso";

  useEffect(() => {
    applySeo({ title, canonicalPath: path });
  }, [title, path]);

  return (
    <div className="container container--narrow">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: title }]} />

      <div className="page-header">
        <h1 className="page-header__title">{title}</h1>
      </div>

      {text ? (
        <div className="prose">
          {text.split("\n").map((paragraph, index) => (paragraph.trim() ? <p key={index}>{paragraph}</p> : null))}
        </div>
      ) : (
        <ContentPlaceholder
          title={`${title} ainda não cadastrada`}
          text="Este texto precisa ser escrito pelo administrador no painel (Configurações → Políticas). Não geramos um texto automático para não assumir condições jurídicas da loja."
          icon="shield"
        />
      )}

      <div className="mt-8">
        <Link to="/contato" className="btn btn--ghost">
          <Icon name="mail" size={16} /> Falar com a loja
        </Link>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

export { formatCurrency };
