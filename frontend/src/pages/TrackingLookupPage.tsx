import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs, Button, Card, Input } from "@/components/ui";
import { applySeo } from "@/lib/seo";

/**
 * Consulta de rastreamento por token.
 *
 * Alternativa pública à área de conta: o cliente digita (ou cola) o código que
 * recebeu na confirmação e vai direto para a página do pedido — sem login.
 */
export default function TrackingLookupPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");

  useEffect(() => {
    applySeo({ title: "Rastrear pedido", noindex: true, canonicalPath: "/rastreio" });
  }, []);

  const trimmed = token.trim();
  const canSubmit = trimmed.length >= 10;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    navigate(`/rastreio/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Rastrear pedido" }]} />

      <div className="page-header">
        <h1 className="page-header__title">Rastrear pedido</h1>
        <p className="page-header__subtitle">
          Informe o código de rastreamento que você recebeu ao finalizar a compra. Nenhum cadastro é necessário.
        </p>
      </div>

      <div style={{ maxWidth: 560 }}>
        <Card>
          <form className="stack stack-4" onSubmit={handleSubmit}>
          <Input
            label="Código de rastreamento"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ex.: 8f4c9e7d2a…"
            hint="Você encontra esse código no link de confirmação do pedido."
            required
          />
            <Button type="submit" size="lg" icon="search" disabled={!canSubmit}>
              Consultar pedido
            </Button>
          </form>
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}
