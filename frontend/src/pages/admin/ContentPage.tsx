import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Icon, LoadingBlock, Tabs } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import type { SiteContentEntry } from "@/types/api";

/**
 * CMS de conteúdo.
 *
 * As chaves nascem VAZIAS. Salvar um valor vazio mantém o campo nulo — e o site
 * continua exibindo o placeholder em vez de inventar informação.
 */
export default function AdminContentPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState<string>("all");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const content = useQuery({
    queryKey: queryKeys.adminContent,
    queryFn: () => api.get<SiteContentEntry[]>("/admin/content"),
  });

  useEffect(() => {
    applySeo({ title: "Conteúdo do site", noindex: true, canonicalPath: "/admin/conteudo" });
  }, []);

  const groups = useMemo(() => {
    const set = new Set((content.data ?? []).map((entry) => entry.group));
    return ["all", ...[...set].sort()];
  }, [content.data]);

  const entries = useMemo(
    () => (content.data ?? []).filter((entry) => group === "all" || entry.group === group),
    [content.data, group],
  );

  const dirtyCount = Object.keys(draft).filter((key) => {
    const original = content.data?.find((entry) => entry.key === key)?.value ?? "";
    return (draft[key] ?? "") !== original;
  }).length;

  const save = useMutation({
    mutationFn: () =>
      api.put<SiteContentEntry[]>("/admin/content", {
        entries: Object.entries(draft).map(([key, value]) => ({ key, value: value.trim() === "" ? null : value })),
      }),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent });
      void queryClient.invalidateQueries({ queryKey: queryKeys.content });
      toast.success("Conteúdo salvo", "As alterações já valem para o site.");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
    onSettled: () => setSaving(false),
  });

  if (content.isLoading) return <LoadingBlock label="Carregando conteúdo…" />;

  return (
    <div>
      <AdminPageHeader
        title="Conteúdo do site"
        subtitle="Textos institucionais, chamadas da home e rodapé. Campos vazios exibem um aviso no site."
        actions={
          <>
            {dirtyCount > 0 ? <Badge tone="warning">{dirtyCount} alteração(ões) não salva(s)</Badge> : null}
            <Button
              icon="check"
              loading={saving || save.isPending}
              disabled={dirtyCount === 0}
              onClick={() => {
                setSaving(true);
                save.mutate();
              }}
            >
              Salvar alterações
            </Button>
          </>
        }
      />

      <Alert tone="info" title="Regra do projeto">
        Nenhum texto é inventado pela loja. Se um campo ficar vazio, o site mostra “Não configurado” em vez de
        publicar informação falsa para o cliente.
      </Alert>

      <div className="mt-5">
        <Tabs
          ariaLabel="Grupos de conteúdo"
          value={group}
          onChange={setGroup}
          tabs={groups.map((item) => ({
            value: item,
            label: item === "all" ? "Todos" : item.charAt(0).toUpperCase() + item.slice(1),
          }))}
        />
      </div>

      <div className="mt-5 stack stack-4">
        {entries.map((entry) => {
          const value = draft[entry.key] ?? entry.value ?? "";
          const isLong = (entry.value?.length ?? 0) > 120 || entry.key.includes("policy") || entry.key.includes("page.");

          return (
            <Card key={entry.key} className="stack stack-2">
              <div className="row row-between row-wrap">
                <div>
                  <label className="field__label" htmlFor={`content-${entry.key}`}>
                    {entry.label ?? entry.key}
                  </label>
                  <code className="text-xs text-subtle">{entry.key}</code>
                </div>
                <div className="row row-2">
                  {entry.isPublic ? (
                    <Badge tone="success">Público</Badge>
                  ) : (
                    <Badge tone="warning">
                      <Icon name="lock" size={11} /> Privado
                    </Badge>
                  )}
                  {entry.value === null ? <Badge tone="neutral">Não configurado</Badge> : null}
                </div>
              </div>

              {isLong ? (
                <textarea
                  id={`content-${entry.key}`}
                  className="textarea"
                  style={{ minHeight: 140 }}
                  value={value}
                  placeholder="Deixe em branco para manter como “Não configurado”."
                  onChange={(event) => setDraft({ ...draft, [entry.key]: event.target.value })}
                />
              ) : (
                <input
                  id={`content-${entry.key}`}
                  className="input"
                  value={value}
                  placeholder="Deixe em branco para manter como “Não configurado”."
                  onChange={(event) => setDraft({ ...draft, [entry.key]: event.target.value })}
                />
              )}
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
          Salvar alterações {dirtyCount > 0 ? `(${dirtyCount})` : ""}
        </Button>
      </div>
    </div>
  );
}
