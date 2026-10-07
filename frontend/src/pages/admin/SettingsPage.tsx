import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Icon, LoadingBlock } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import type { SiteContentEntry } from "@/types/api";

type SettingsResponse = { items: SiteContentEntry[]; grouped: Record<string, SiteContentEntry[]> };

const GROUP_LABELS: Record<string, { title: string; description: string; icon: "store" | "instagram" | "creditCard" | "truck" | "shield" }> = {
  loja: { title: "Dados da loja", description: "Nome, contato, endereço e informações fiscais.", icon: "store" },
  redes: { title: "Redes sociais", description: "Perfis oficiais da loja.", icon: "instagram" },
  pagamento: { title: "Recebimento e pagamento", description: "Chave PIX, conta e meios habilitados.", icon: "creditCard" },
  frete: { title: "Frete e entrega", description: "Origem do despacho, frete grátis e observações.", icon: "truck" },
  politicas: { title: "Políticas e páginas", description: "Privacidade, termos, trocas e textos institucionais.", icon: "shield" },
};

/**
 * Configurações gerais da loja.
 *
 * Os campos ficam agrupados por área. Campos sensíveis (chave PIX, razão social,
 * conta de recebimento) são marcados como privados e NUNCA saem na API pública.
 */
export default function AdminSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const settings = useQuery({
    queryKey: queryKeys.adminSettings,
    queryFn: () => api.get<SettingsResponse>("/admin/settings"),
  });

  useEffect(() => {
    applySeo({ title: "Configurações", noindex: true, canonicalPath: "/admin/configuracoes" });
  }, []);

  const dirtyCount = useMemo(() => {
    return Object.keys(draft).filter((key) => {
      const original = settings.data?.items.find((item) => item.key === key)?.value ?? "";
      return (draft[key] ?? "") !== original;
    }).length;
  }, [draft, settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SiteContentEntry[]>("/admin/content", {
        entries: Object.entries(draft).map(([key, value]) => ({ key, value: value.trim() === "" ? null : value })),
      }),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.content });
      toast.success("Configurações salvas", "As alterações já valem para a loja.");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
    onSettled: () => setSaving(false),
  });

  if (settings.isLoading) return <LoadingBlock label="Carregando configurações…" />;

  const grouped = settings.data?.grouped ?? {};

  return (
    <div>
      <AdminPageHeader
        title="Configurações"
        subtitle="Preencha os dados reais da loja. Campos vazios aparecem como “não configurado” no site."
        actions={
          <>
            {dirtyCount > 0 ? <Badge tone="warning">{dirtyCount} alteração(ões)</Badge> : null}
            <Button
              icon="check"
              loading={saving || save.isPending}
              disabled={dirtyCount === 0}
              onClick={() => {
                setSaving(true);
                save.mutate();
              }}
            >
              Salvar configurações
            </Button>
          </>
        }
      />

      <Alert tone="warning" title="Dados sensíveis">
        Campos marcados como <strong>Privado</strong> (chave PIX, razão social, conta de recebimento) ficam guardados
        apenas no servidor e <strong>nunca</strong> são enviados para o site público. Os pagamentos só aparecem para o
        cliente quando o meio correspondente estiver marcado como habilitado.
      </Alert>

      <div className="grid mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", alignItems: "start" }}>
        {Object.entries(grouped).map(([group, items]) => {
          const meta = GROUP_LABELS[group];
          return (
            <Card key={group} className="stack stack-4">
              <div className="row row-3">
                <span className="empty-state__icon" style={{ width: 40, height: 40, margin: 0, background: "var(--color-accent-soft)" }}>
                  <Icon name={meta?.icon ?? "settings"} size={19} />
                </span>
                <div>
                  <h3 className="card__title">{meta?.title ?? group}</h3>
                  {meta?.description ? <p className="text-xs text-muted">{meta.description}</p> : null}
                </div>
              </div>

              {items.map((item) => {
                const value = draft[item.key] ?? item.value ?? "";
                const isLong = (item.value?.length ?? 0) > 120 || item.key.startsWith("policy.") || item.key.startsWith("payment.notes");

                return (
                  <div key={item.key} className="stack stack-2">
                    <div className="row row-between row-wrap">
                      <label className="field__label" htmlFor={`setting-${item.key}`}>
                        {item.label ?? item.key}
                      </label>
                      {item.isPublic ? (
                        <Badge tone="success">Público</Badge>
                      ) : (
                        <Badge tone="warning">
                          <Icon name="lock" size={11} /> Privado
                        </Badge>
                      )}
                    </div>

                    {isLong ? (
                      <textarea
                        id={`setting-${item.key}`}
                        className="textarea"
                        value={value}
                        placeholder="Ainda não configurado"
                        onChange={(event) => setDraft({ ...draft, [item.key]: event.target.value })}
                      />
                    ) : (
                      <input
                        id={`setting-${item.key}`}
                        className="input"
                        value={value}
                        placeholder="Ainda não configurado"
                        onChange={(event) => setDraft({ ...draft, [item.key]: event.target.value })}
                      />
                    )}

                    <code className="text-xs text-subtle">{item.key}</code>
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>

      <div className="row row-end mt-6">
        <Button
          size="lg"
          icon="check"
          loading={saving || save.isPending}
          disabled={dirtyCount === 0}
          onClick={() => {
            setSaving(true);
            save.mutate();
          }}
        >
          Salvar configurações {dirtyCount > 0 ? `(${dirtyCount})` : ""}
        </Button>
      </div>

      <Alert tone="info" title="Primeiro acesso com dados de demonstração?">
        Troque a senha do administrador de teste e remova as contas/produtos marcados como <strong>[DEMO]</strong> antes
        de divulgar a loja.
      </Alert>
    </div>
  );
}
