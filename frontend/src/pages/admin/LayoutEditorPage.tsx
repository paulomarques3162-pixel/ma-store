import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Icon,
  Input,
  LoadingBlock,
  Select,
  StatCard,
} from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type { ThemeSettings } from "@/types/api";

type ThemeRecord = { id: string; name: string; settings: ThemeSettings; isDraft: boolean; isActive: boolean; publishedAt: string | null; updatedAt: string };

/** Personalização visual com fluxo rascunho → publicar. */
export default function AdminLayoutEditorPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<ThemeSettings>({
    primaryColor: "#24170D",
    accentColor: "#B8935F",
    backgroundColor: "#FBF9F6",
    surfaceColor: "#FFFFFF",
    textColor: "#24170D",
    buttonRadius: 10,
    cardRadius: 16,
    buttonStyle: "solid",
  });
  const [name, setName] = useState("Meu tema");

  const theme = useQuery({
    queryKey: queryKeys.adminTheme,
    queryFn: () => api.get<{ draft: ThemeRecord | null; active: ThemeRecord | null; history: ThemeRecord[] }>("/admin/theme"),
  });

  useEffect(() => {
    applySeo({ title: "Layout e tema", noindex: true, canonicalPath: "/admin/layout" });
  }, []);

  useEffect(() => {
    const source = theme.data?.draft ?? theme.data?.active;
    if (!source) return;
    setName(source.name);
    setForm({
      primaryColor: source.settings?.primaryColor ?? "#24170D",
      accentColor: source.settings?.accentColor ?? "#B8935F",
      backgroundColor: source.settings?.backgroundColor ?? "#FBF9F6",
      surfaceColor: source.settings?.surfaceColor ?? "#FFFFFF",
      textColor: source.settings?.textColor ?? "#24170D",
      buttonRadius: source.settings?.buttonRadius ?? 10,
      cardRadius: source.settings?.cardRadius ?? 16,
      buttonStyle: source.settings?.buttonStyle ?? "solid",
    });
  }, [theme.data]);

  // Pré-visualização em tempo real, aplicada ao próprio painel.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-primary", form.primaryColor ?? "#24170D");
    root.style.setProperty("--color-accent", form.accentColor ?? "#B8935F");
    root.style.setProperty("--color-bg", form.backgroundColor ?? "#FBF9F6");
    root.style.setProperty("--color-surface", form.surfaceColor ?? "#FFFFFF");
    root.style.setProperty("--color-text", form.textColor ?? "#24170D");
    root.style.setProperty("--radius-button", `${form.buttonRadius ?? 10}px`);
    root.style.setProperty("--radius-card", `${form.cardRadius ?? 16}px`);

    return () => {
      for (const variable of ["--color-primary", "--color-accent", "--color-bg", "--color-surface", "--color-text", "--radius-button", "--radius-card"]) {
        root.style.removeProperty(variable);
      }
    };
  }, [form]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminTheme });
    void queryClient.invalidateQueries({ queryKey: queryKeys.theme });
  };

  const createDraft = useMutation({
    mutationFn: () => api.post<ThemeRecord>("/admin/theme", { name, settings: form }),
    onSuccess: () => {
      invalidate();
      toast.success("Rascunho criado", "Edite e publique quando estiver pronto.");
    },
    onError: (error) => toast.error("Não foi possível criar o rascunho", errorMessage(error)),
  });

  const updateDraft = useMutation({
    mutationFn: () => api.patch(`/admin/theme/${theme.data?.draft?.id}`, { name, settings: form }),
    onSuccess: () => {
      invalidate();
      toast.success("Rascunho atualizado");
    },
    onError: (error) => toast.error("Não foi possível salvar o rascunho", errorMessage(error)),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/admin/theme/${theme.data?.draft?.id}/publish`),
    onSuccess: () => {
      invalidate();
      toast.success("Tema publicado", "O site já está usando a nova aparência.");
    },
    onError: (error) => toast.error("Não foi possível publicar", errorMessage(error)),
  });

  const duplicateActive = useMutation({
    mutationFn: () => api.post<ThemeRecord>(`/admin/theme/${theme.data?.active?.id}/draft`),
    onSuccess: () => {
      invalidate();
      toast.success("Rascunho criado a partir do tema publicado");
    },
    onError: (error) => toast.error("Não foi possível duplicar", errorMessage(error)),
  });

  if (theme.isLoading) return <LoadingBlock label="Carregando tema…" />;

  const draft = theme.data?.draft ?? null;
  const active = theme.data?.active ?? null;

  return (
    <div>
      <AdminPageHeader
        title="Layout e tema"
        subtitle="Cores, formas e identidade visual. Nada é publicado até você confirmar."
        actions={
          <>
            {draft ? (
              <>
                <Button variant="ghost" icon="check" onClick={() => updateDraft.mutate()} loading={updateDraft.isPending}>
                  Salvar rascunho
                </Button>
                <Button icon="upload" onClick={() => publish.mutate()} loading={publish.isPending}>
                  Publicar tema
                </Button>
              </>
            ) : (
              <>
                {active ? (
                  <Button variant="ghost" icon="copy" onClick={() => duplicateActive.mutate()} loading={duplicateActive.isPending}>
                    Criar rascunho do publicado
                  </Button>
                ) : null}
                <Button icon="plus" onClick={() => createDraft.mutate()} loading={createDraft.isPending}>
                  Criar rascunho
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="admin-stats mb-5">
        <StatCard
          label="Tema publicado"
          value={active ? active.name : "Nenhum"}
          hint={active?.publishedAt ? `Publicado em ${formatDateTime(active.publishedAt)}` : "O site usa o padrão do sistema"}
          icon="palette"
          tone={active ? "success" : "warning"}
        />
        <StatCard
          label="Rascunho"
          value={draft ? draft.name : "Nenhum"}
          hint={draft ? `Atualizado em ${formatDateTime(draft.updatedAt)}` : "Crie um rascunho para editar"}
          icon="edit"
        />
      </div>

      <Alert tone="info" title="Como funciona">
        Crie um <strong>rascunho</strong>, ajuste as cores com pré-visualização e só então clique em{" "}
        <strong>Publicar</strong>. O tema publicado não é editável diretamente — isso evita mudanças acidentais no
        site no ar.
      </Alert>

      <div className="grid mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <Card className="stack stack-4">
          <h3 className="card__title">Cores e formas</h3>

          <Input label="Nome do tema" value={name} onChange={(event) => setName(event.target.value)} />

          <div className="grid grid-2">
            <div className="field">
              <label className="field__label" htmlFor="primary">Cor principal</label>
              <input
                id="primary"
                type="color"
                className="input"
                style={{ height: 44, padding: 4 }}
                value={form.primaryColor ?? "#24170D"}
                onChange={(event) => setForm({ ...form, primaryColor: event.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="accent">Cor de destaque</label>
              <input
                id="accent"
                type="color"
                className="input"
                style={{ height: 44, padding: 4 }}
                value={form.accentColor ?? "#B8935F"}
                onChange={(event) => setForm({ ...form, accentColor: event.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label className="field__label" htmlFor="bg">Fundo</label>
              <input
                id="bg"
                type="color"
                className="input"
                style={{ height: 44, padding: 4 }}
                value={form.backgroundColor ?? "#FBF9F6"}
                onChange={(event) => setForm({ ...form, backgroundColor: event.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="surface">Superfícies (cards)</label>
              <input
                id="surface"
                type="color"
                className="input"
                style={{ height: 44, padding: 4 }}
                value={form.surfaceColor ?? "#FFFFFF"}
                onChange={(event) => setForm({ ...form, surfaceColor: event.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="text">Cor do texto</label>
            <input
              id="text"
              type="color"
              className="input"
              style={{ height: 44, padding: 4 }}
              value={form.textColor ?? "#24170D"}
              onChange={(event) => setForm({ ...form, textColor: event.target.value })}
            />
          </div>

          <Input
            label="Arredondamento dos botões (px)"
            type="number"
            min="0"
            max="30"
            value={String(form.buttonRadius ?? 10)}
            onChange={(event) => setForm({ ...form, buttonRadius: Number(event.target.value) })}
          />

          <Input
            label="Arredondamento dos cards (px)"
            type="number"
            min="0"
            max="40"
            value={String(form.cardRadius ?? 16)}
            onChange={(event) => setForm({ ...form, cardRadius: Number(event.target.value) })}
          />

          <Select
            label="Estilo dos botões"
            value={form.buttonStyle ?? "solid"}
            onChange={(event) => setForm({ ...form, buttonStyle: event.target.value as ThemeSettings["buttonStyle"] })}
            options={[
              { value: "solid", label: "Sólido" },
              { value: "outline", label: "Contorno" },
              { value: "pill", label: "Pílula" },
            ]}
          />
        </Card>

        <div className="stack stack-5">
          <Card className="stack stack-4">
            <h3 className="card__title">Pré-visualização</h3>
            <p className="text-sm text-muted">As cores abaixo refletem o rascunho atual.</p>

            <div
              style={{
                background: form.backgroundColor,
                color: form.textColor,
                border: "1px solid var(--color-border)",
                borderRadius: form.cardRadius,
                padding: "var(--space-5)",
              }}
            >
              <div style={{ background: form.surfaceColor, borderRadius: form.cardRadius, padding: "var(--space-4)" }}>
                <p style={{ fontWeight: 600, marginBottom: 8 }}>Exemplo de card de produto</p>
                <p style={{ fontSize: "var(--text-sm)", opacity: 0.75, marginBottom: 12 }}>
                  Texto de apoio com a cor configurada.
                </p>
                <div className="row row-2 row-wrap">
                  <span
                    style={{
                      background: form.primaryColor,
                      color: "#fff",
                      borderRadius: form.buttonRadius,
                      padding: "10px 18px",
                      fontSize: "var(--text-sm)",
                      fontWeight: 600,
                    }}
                  >
                    Botão principal
                  </span>
                  <span
                    style={{
                      background: form.accentColor,
                      color: "#24170D",
                      borderRadius: form.buttonRadius,
                      padding: "10px 18px",
                      fontSize: "var(--text-sm)",
                      fontWeight: 600,
                    }}
                  >
                    Botão de destaque
                  </span>
                </div>
              </div>
            </div>

            <Checkbox
              label="Confirmo que revisei o contraste das cores (acessibilidade)"
              checked={false}
              onChange={() => undefined}
              disabled
            />
          </Card>

          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">Histórico de temas</h3>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              {(theme.data?.history ?? []).length === 0 ? (
                <p className="text-sm text-muted">Nenhum tema criado ainda.</p>
              ) : (
                <div className="stack stack-3">
                  {(theme.data?.history ?? []).map((item) => (
                    <div key={item.id} className="row row-between row-wrap">
                      <div>
                        <div className="text-sm">{item.name}</div>
                        <div className="text-xs text-muted">{formatDateTime(item.updatedAt)}</div>
                      </div>
                      <div className="row row-2">
                        {item.isActive ? (
                          <Badge tone="success">
                            <Icon name="check" size={11} /> Publicado
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Rascunho</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Alert tone="warning" title="Logo e favicon">
            O logo atual é o arquivo enviado pela loja. Para trocá-lo, substitua o arquivo do projeto ou informe uma
            URL no campo correspondente do tema — a loja nunca gera uma marca fictícia.
          </Alert>
        </div>
      </div>
    </div>
  );
}
