import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Icon,
  Input,
  Modal,
  Progress,
  SearchInput,
  Select,
  StatCard,
} from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, downloadAuthenticatedFile, errorMessage, errorRequestId } from "@/lib/api";
import { invalidateStorefront, queryKeys } from "@/lib/queryClient";
import { formatDateTime, formatNumber } from "@/lib/format";
import { resolveImageUrl } from "@/lib/images";

/* -------------------------------------------------------------------------- */
/* Tipos da API                                                               */
/* -------------------------------------------------------------------------- */

type Summary = {
  products: number;
  productsWithoutImage: number;
  references: number;
  total: number;
  working: number;
  broken: number;
  recoverable: number;
  unavailable: number;
  temporary: number;
  migrated: number;
  awaitingAnalysis: number;
  awaitingConfirmation: number;
  duplicates: number;
  byType: Record<string, number>;
  byStatus: Array<{ status: string; label: string; count: number }>;
  lastScanAt: string | null;
  lastCheckAt: string | null;
  storage: { driver: string; persistent: boolean; cloudinaryConfigured: boolean; cloudinaryFolder: string | null };
  limits: { maxMb: number; timeoutMs: number; maxRedirects: number; defaultConcurrency: number; recheckHours: number };
};

type Asset = {
  id: string;
  assetType: "PRODUCT_IMAGE" | "BANNER" | "CATEGORY" | "BRAND";
  assetId: string;
  productId: string | null;
  productName: string | null;
  label: string;
  field: string;
  status: string;
  currentUrl: string;
  originalUrl: string | null;
  recoveredUrl: string | null;
  newUrl: string | null;
  publicId: string | null;
  storageProvider: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  httpStatus: number | null;
  contentType: string | null;
  failureReason: string | null;
  attempts: number;
  lastCheckedAt: string | null;
  recoveredAt: string | null;
  canRecover: boolean;
  isCloudinary: boolean;
  awaitingConfirmation: boolean;
};

type RecoverOutcome = { ok: boolean; message: string; asset: Asset };

type JobItem = {
  id: string;
  assetId: string | null;
  label: string;
  originalUrl: string;
  status: string;
  result: string | null;
  message: string | null;
  newUrl: string | null;
};

type Job = {
  id: string;
  status: "PENDING" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELED";
  filter: string | null;
  search: string | null;
  concurrency: number;
  autoConfirm: boolean;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  percent: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  items: JobItem[];
  confirmedNow?: number;
  failedNow?: number;
};

/* -------------------------------------------------------------------------- */
/* Helpers de apresentação                                                     */
/* -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Aguardando análise",
  AVAILABLE: "Disponível",
  RECOVERABLE: "Recuperável",
  REDIRECT: "Redirecionamento",
  INVALID_URL: "URL inválida",
  NOT_FOUND: "Não encontrado",
  SERVER_UNAVAILABLE: "Servidor indisponível",
  INVALID_CONTENT: "Conteúdo inválido",
  ACCESS_BLOCKED: "Bloqueio de acesso",
  CONNECTION_ERROR: "Erro de conexão",
  PENDING_CONFIRMATION: "Aguardando confirmação",
  RECOVERED: "Recuperada",
  CLOUDINARY: "No Cloudinary",
  UNAVAILABLE: "Indisponível",
};

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  AVAILABLE: "success",
  RECOVERABLE: "accent",
  REDIRECT: "accent",
  CLOUDINARY: "success",
  RECOVERED: "success",
  PENDING_CONFIRMATION: "warning",
  PENDING: "neutral",
  SERVER_UNAVAILABLE: "warning",
  CONNECTION_ERROR: "warning",
  ACCESS_BLOCKED: "warning",
  NOT_FOUND: "danger",
  INVALID_URL: "danger",
  INVALID_CONTENT: "danger",
  UNAVAILABLE: "danger",
};

const TYPE_LABELS: Record<string, string> = {
  PRODUCT_IMAGE: "Produto",
  BANNER: "Banner",
  CATEGORY: "Categoria",
  BRAND: "Marca",
};

const FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "broken", label: "Quebradas" },
  { value: "recoverable", label: "Recuperáveis" },
  { value: "unavailable", label: "Indisponíveis" },
  { value: "recovered", label: "Recuperadas" },
  { value: "cloudinary", label: "Já no Cloudinary" },
  { value: "pending", label: "Aguardando análise/confirmação" },
];

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Thumb({ url, alt, size = 44 }: { url: string | null | undefined; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = resolveImageUrl(url);
  useEffect(() => setFailed(false), [url]);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        overflow: "hidden",
        flexShrink: 0,
        background: "var(--color-surface-2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="image" size={18} />
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Página                                                                      */
/* -------------------------------------------------------------------------- */

export default function AdminImageRecoveryPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAutoConfirm, setBatchAutoConfirm] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState(3);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    applySeo({
      title: "Recuperador de imagens",
      noindex: true,
      canonicalPath: "/admin/midia/recuperador",
    });
  }, []);

  useEffect(() => setPage(1), [filter, type, search]);

  const summary = useQuery({
    queryKey: queryKeys.adminImageRecoverySummary,
    queryFn: () => api.get<Summary>("/admin/image-recovery/summary"),
    staleTime: 10_000,
  });

  const assets = useQuery({
    queryKey: queryKeys.adminImageRecoveryAssets({ filter, type, search, page }),
    queryFn: () =>
      api.list<Asset[]>("/admin/image-recovery/assets", {
        query: { status: filter === "all" ? undefined : filter, type: type === "all" ? undefined : type, search: search || undefined, page, perPage: 20 },
      }),
    placeholderData: (previous) => previous,
  });

  const jobs = useQuery({
    queryKey: queryKeys.adminImageRecoveryJobs,
    queryFn: () => api.get<Job[]>("/admin/image-recovery/jobs", { query: { limit: 10 } }),
    refetchInterval: (query) => {
      const list = query.state.data;
      return Array.isArray(list) && list.some((job) => job.status === "RUNNING") ? 2000 : 20_000;
    },
  });

  const activeJob = useQuery({
    queryKey: queryKeys.adminImageRecoveryJob(activeJobId ?? "none"),
    queryFn: () => api.get<Job>(`/admin/image-recovery/jobs/${activeJobId}`),
    enabled: Boolean(activeJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "RUNNING" || status === "PENDING" ? 1500 : false;
    },
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "image-recovery"] });
    invalidateStorefront(queryClient);
  };

  const scan = useMutation({
    mutationFn: () => api.post<{ scanned: number; created: number; updated: number; duplicates: Array<{ url: string; count: number }> }>("/admin/image-recovery/scan"),
    onSuccess: (data) => {
      invalidateAll();
      toast.success(
        "Auditoria concluída",
        `${formatNumber(data.scanned)} referências analisadas • ${data.created} novas • ${data.updated} atualizadas.`,
      );
    },
    onError: (error) => toast.error("Não foi possível auditar", errorMessage(error)),
  });

  const check = useMutation({
    mutationFn: (id: string) => api.post<Asset>(`/admin/image-recovery/assets/${id}/check`),
    onSuccess: (asset) => {
      invalidateAll();
      setSelected((current) => (current?.id === asset.id ? asset : current));
      toast.info("Verificação concluída", STATUS_LABELS[asset.status] ?? asset.status);
    },
    onError: (error) => toast.error("Não foi possível verificar", errorMessage(error)),
  });

  const recover = useMutation({
    mutationFn: (id: string) => api.post<RecoverOutcome>(`/admin/image-recovery/assets/${id}/recover`),
    onSuccess: (outcome) => {
      invalidateAll();
      setSelected(outcome.asset);
      if (outcome.ok) toast.success("Imagem recuperada", outcome.message);
      else toast.error("Não foi possível recuperar", outcome.message);
    },
    onError: (error) => toast.error("Não foi possível recuperar", errorMessage(error)),
  });

  const confirm = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "replace" | "keep" | "cancel" }) =>
      api.post<{ ok: boolean; message: string; asset: Asset; updatedTarget: boolean }>(`/admin/image-recovery/assets/${id}/confirm`, { action }),
    onSuccess: (outcome) => {
      invalidateAll();
      if (outcome.updatedTarget) {
        setSelected(null);
        toast.success("Referência atualizada", outcome.message);
      } else {
        setSelected(outcome.asset);
        toast.info("Imagem antiga mantida", outcome.message);
      }
    },
    onError: (error) => toast.error("Não foi possível confirmar", errorMessage(error)),
  });

  const submitManualUrl = useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) =>
      api.post<Asset>(`/admin/image-recovery/assets/${id}/manual-url`, { url }),
    onSuccess: (asset) => {
      invalidateAll();
      setSelected(asset);
      setManualUrl("");
      toast.success("URL validada", "Confira a pré-visualização antes de confirmar.");
    },
    onError: (error) => toast.error("URL recusada", errorMessage(error)),
  });

  const manualUpload = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      const { tokenStore } = await import("@/lib/api");
      const token = tokenStore.getAccess();
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
      const response = await fetch(`${base}/admin/image-recovery/assets/${id}/manual-upload`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as { data?: Asset; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "Falha no upload manual.");
      return payload?.data as Asset;
    },
    onSuccess: (asset) => {
      invalidateAll();
      setSelected(asset);
      toast.success("Imagem enviada", "Confirme a substituição na pré-visualização.");
    },
    onError: (error) => toast.error("Falha no upload", errorMessage(error)),
  });

  const startBatch = useMutation({
    mutationFn: () =>
      api.post<Job>("/admin/image-recovery/jobs", {
        filter: "recoverable",
        search: search || undefined,
        concurrency: batchConcurrency,
        autoConfirm: batchAutoConfirm,
      }),
    onSuccess: (job) => {
      setBatchOpen(false);
      setActiveJobId(job.id);
      invalidateAll();
      toast.success("Recuperação em massa iniciada", `${job.total} imagens na fila. Você pode pausar a qualquer momento.`);
    },
    onError: (error) => toast.error("Não foi possível iniciar", errorMessage(error)),
  });

  const jobAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" | "confirm" }) =>
      api.post<Job>(`/admin/image-recovery/jobs/${id}/${action}`, action === "confirm" ? {} : undefined),
    onSuccess: (_data, variables) => {
      invalidateAll();
      if (variables.action === "confirm") toast.success("Lote confirmado", "As referências selecionadas foram atualizadas.");
      if (variables.action === "pause") toast.info("Processo pausado");
      if (variables.action === "resume") toast.info("Processo retomado");
      if (variables.action === "cancel") toast.info("Processo cancelado");
    },
    onError: (error) => toast.error("Ação não concluída", errorMessage(error)),
  });

  const rows = assets.data?.data ?? [];
  const meta = assets.data?.meta;

  const columns: Array<AdminColumn<Asset>> = useMemo(
    () => [
      {
        key: "product",
        header: "Produto / referência",
        render: (asset) => (
          <div className="row row-3">
            <Thumb url={asset.currentUrl} alt={asset.label} />
            <div style={{ minWidth: 0 }}>
              <div className="text-sm text-strong clamp-1">{asset.productName ?? asset.label}</div>
              <div className="text-xs text-muted">
                {TYPE_LABELS[asset.assetType] ?? asset.assetType} • {asset.productId ? "imagem de produto" : asset.field}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: "current",
        header: "Imagem atual",
        hideOnMobile: true,
        render: (asset) => (
          <div className="text-xs text-muted" style={{ maxWidth: 240 }}>
            <div className="row row-2">
              <Thumb url={asset.currentUrl} alt="Prévia" size={36} />
              <span className="clamp-1" title={asset.currentUrl}>
                {asset.currentUrl.startsWith("data:") ? "imagem embutida" : asset.currentUrl}
              </span>
            </div>
            {asset.width && asset.height ? (
              <div className="text-subtle mt-1">
                {asset.width}×{asset.height} • {formatBytes(asset.sizeBytes)}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: "original",
        header: "URL original",
        hideOnMobile: true,
        render: (asset) => (
          <span className="text-xs text-muted clamp-1" style={{ maxWidth: 260, display: "block" }} title={asset.originalUrl ?? asset.currentUrl}>
            {asset.originalUrl ?? asset.currentUrl}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (asset) => (
          <div className="stack stack-1">
            <Badge tone={STATUS_TONE[asset.status] ?? "neutral"}>{STATUS_LABELS[asset.status] ?? asset.status}</Badge>
            {asset.awaitingConfirmation ? <span className="text-xs text-subtle">Prévia pronta</span> : null}
          </div>
        ),
      },
      {
        key: "actions",
        header: "Ação",
        align: "right",
        render: (asset) => (
          <RowActions>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => check.mutate(asset.id)} loading={check.isPending && check.variables === asset.id}>
              Testar
            </Button>
            {asset.awaitingConfirmation ? (
              <Button size="sm" variant="primary" icon="check" onClick={() => setSelected(asset)}>
                Revisar
              </Button>
            ) : asset.canRecover ? (
              <Button size="sm" variant="primary" icon="download" onClick={() => recover.mutate(asset.id)} loading={recover.isPending && recover.variables === asset.id}>
                Recuperar
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon="eye" onClick={() => setSelected(asset)}>
                Investigar
              </Button>
            )}
          </RowActions>
        ),
      },
    ],
    [check, recover],
  );

  const job = activeJob.data;

  return (
    <div className="stack stack-6">
      <AdminPageHeader
        title="Recuperador de imagens"
        subtitle="Localiza as URLs antigas no PostgreSQL, verifica a disponibilidade, copia a imagem original para o Cloudinary e só substitui a referência após a sua confirmação."
        actions={
          <>
            <Button variant="ghost" icon="download" onClick={() => void downloadAuthenticatedFile("/admin/image-recovery/report.csv", "recuperacao-de-imagens.csv")}>
              Exportar CSV
            </Button>
            <Button variant="subtle" icon="refresh" onClick={() => scan.mutate()} loading={scan.isPending}>
              Auditar imagens
            </Button>
            <Button variant="primary" icon="sparkles" onClick={() => setBatchOpen(true)}>
              Recuperar recuperáveis
            </Button>
          </>
        }
      />

      {!summary.data?.storage.cloudinaryConfigured ? (
        <Alert tone="warning" title="Cloudinary ainda não configurado">
          Defina <code>STORAGE_DRIVER=cloudinary</code>, <code>CLOUDINARY_CLOUD_NAME</code>, <code>CLOUDINARY_API_KEY</code> e{" "}
          <code>CLOUDINARY_API_SECRET</code> no backend. A verificação de URLs funciona sem essas variáveis, mas a recuperação
          (upload para o CDN) fica bloqueada com mensagem explicativa.
        </Alert>
      ) : null}

      {summary.error ? (
        <Alert tone="danger" title="Não foi possível carregar os indicadores">
          {errorMessage(summary.error)}
          {errorRequestId(summary.error) ? <span className="text-xs text-subtle"> • {errorRequestId(summary.error)}</span> : null}
        </Alert>
      ) : null}

      <div className="admin-stats">
        <StatCard label="Produtos cadastrados" value={formatNumber(summary.data?.products)} hint={`${summary.data?.productsWithoutImage ?? 0} sem imagem`} icon="boxes" />
        <StatCard label="Imagens identificadas" value={formatNumber(summary.data?.total)} hint={`${summary.data?.byType?.PRODUCT_IMAGE ?? 0} de produtos`} icon="image" />
        <StatCard label="Funcionando" value={formatNumber(summary.data?.working)} hint="Acessíveis ou já migradas" icon="checkCircle" tone="success" />
        <StatCard label="Quebradas" value={formatNumber(summary.data?.broken)} hint={`${summary.data?.temporary ?? 0} com erro temporário`} icon="alertTriangle" tone={summary.data?.broken ? "warning" : undefined} />
      </div>
      <div className="admin-stats">
        <StatCard label="Recuperáveis" value={formatNumber(summary.data?.recoverable)} hint="Prontas para copiar ao Cloudinary" icon="download" />
        <StatCard label="Indisponíveis" value={formatNumber(summary.data?.unavailable)} hint="404/URL inválida/conteúdo inválido" icon="xCircle" tone={summary.data?.unavailable ? "danger" : undefined} />
        <StatCard label="Já no Cloudinary" value={formatNumber(summary.data?.migrated)} hint="Migradas ou recuperadas" icon="shieldCheck" tone="success" />
        <StatCard label="Aguardando" value={formatNumber((summary.data?.awaitingAnalysis ?? 0) + (summary.data?.awaitingConfirmation ?? 0))} hint={`${summary.data?.awaitingConfirmation ?? 0} para confirmar`} icon="clock" />
      </div>

      {summary.data ? (
        <Card>
          <div className="row row-between row-wrap" style={{ gap: "var(--space-3)" }}>
            <div className="text-sm text-muted">
              Última auditoria: <strong>{summary.data.lastScanAt ? formatDateTime(summary.data.lastScanAt) : "nunca"}</strong> • Última verificação:{" "}
              <strong>{summary.data.lastCheckAt ? formatDateTime(summary.data.lastCheckAt) : "—"}</strong>
            </div>
            <div className="row row-2 row-wrap">
              <Badge tone="neutral">Driver: {summary.data.storage.driver}</Badge>
              <Badge tone={summary.data.storage.cloudinaryConfigured ? "success" : "warning"}>
                Cloudinary: {summary.data.storage.cloudinaryConfigured ? "conectado" : "não configurado"}
              </Badge>
              <Badge tone={summary.data.duplicates > 0 ? "warning" : "neutral"}>{summary.data.duplicates} URL(s) duplicada(s)</Badge>
            </div>
          </div>
        </Card>
      ) : null}

      {job ? (
        <Card>
          <div className="row row-between row-wrap mb-3">
            <div>
              <h3 className="card__title">Processo em massa</h3>
              <p className="text-sm text-muted">
                {job.status} • {job.processed}/{job.total} processados • {job.succeeded} sucesso(s) • {job.failed} falha(s)
                {job.autoConfirm ? " • confirmação automática" : " • aguardando confirmação"}
              </p>
            </div>
            <div className="row row-2 row-wrap">
              {job.status === "RUNNING" || job.status === "PENDING" ? (
                <Button size="sm" variant="ghost" icon="clock" onClick={() => jobAction.mutate({ id: job.id, action: "pause" })}>
                  Pausar
                </Button>
              ) : null}
              {job.status === "PAUSED" ? (
                <Button size="sm" variant="subtle" icon="refresh" onClick={() => jobAction.mutate({ id: job.id, action: "resume" })}>
                  Continuar
                </Button>
              ) : null}
              {["RUNNING", "PAUSED", "PENDING"].includes(job.status) ? (
                <Button size="sm" variant="ghost" icon="close" onClick={() => jobAction.mutate({ id: job.id, action: "cancel" })}>
                  Cancelar
                </Button>
              ) : null}
              {!job.autoConfirm && job.items.some((item) => item.status === "AWAITING_CONFIRMATION") ? (
                <Button size="sm" variant="primary" icon="check" onClick={() => jobAction.mutate({ id: job.id, action: "confirm" })}>
                  Confirmar lote
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setActiveJobId(null)}>
                Ocultar
              </Button>
            </div>
          </div>
          <Progress value={job.processed} max={Math.max(1, job.total)} label="Progresso da recuperação" />
          {job.error ? <p className="text-sm text-danger mt-2">{job.error}</p> : null}
          {job.items.length > 0 ? (
            <div className="table-wrap mt-3" style={{ maxHeight: 260, overflow: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Status</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {job.items.slice(0, 50).map((item) => (
                    <tr key={item.id}>
                      <td className="text-sm">{item.label}</td>
                      <td>
                        <Badge tone={item.status === "FAILED" ? "danger" : item.status === "CONFIRMED" || item.status === "RECOVERED" ? "success" : "neutral"}>
                          {item.status}
                        </Badge>
                      </td>
                      <td className="text-xs text-muted">{item.message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      {jobs.data && jobs.data.length > 0 ? (
        <Card>
          <div className="row row-between row-wrap mb-3">
            <h3 className="card__title">Últimos processos</h3>
            <span className="text-xs text-muted">O estado fica no PostgreSQL e é retomado após restart do backend.</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Iniciado</th>
                  <th>Status</th>
                  <th>Progresso</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-sm">{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <Badge tone={entry.status === "COMPLETED" ? "success" : entry.status === "FAILED" ? "danger" : entry.status === "RUNNING" ? "accent" : "neutral"}>
                        {entry.status}
                      </Badge>
                    </td>
                    <td className="text-sm text-muted">
                      {entry.processed}/{entry.total} • {entry.succeeded} ok • {entry.failed} falha(s)
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" icon="eye" onClick={() => setActiveJobId(entry.id)}>
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="mb-4">
          <div className="row row-between row-wrap mb-3">
            <h3 className="card__title">Referências de imagem</h3>
            <span className="text-xs text-muted">Produtos, banners, categorias e marcas • {formatNumber(meta?.total ?? rows.length)} registro(s)</span>
          </div>
          <div className="row row-2 row-wrap">
            <div style={{ flex: "1 1 260px" }}>
              <SearchInput
                value={searchInput}
                onValue={setSearchInput}
                onSubmitQuery={(value) => setSearch(value.trim())}
                placeholder="Pesquisar pelo nome do produto"
              />
            </div>
            <Select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="Filtrar por status"
              options={FILTER_OPTIONS}
            />
            <Select
              value={type}
              onChange={(event) => setType(event.target.value)}
              aria-label="Filtrar por tipo"
              options={[
                { value: "all", label: "Todos os tipos" },
                { value: "PRODUCT_IMAGE", label: "Produtos" },
                { value: "BANNER", label: "Banners" },
                { value: "CATEGORY", label: "Categorias" },
                { value: "BRAND", label: "Marcas" },
              ]}
            />
            <Button variant="ghost" icon="search" onClick={() => setSearch(searchInput.trim())}>
              Buscar
            </Button>
          </div>
        </div>

        <AdminTable
          columns={columns}
          rows={rows}
          loading={assets.isLoading}
          error={assets.error}
          requestId={errorRequestId(assets.error)}
          onRetry={() => void assets.refetch()}
          emptyTitle="Nenhuma referência encontrada"
          emptyText="Clique em “Auditar imagens” para localizar as referências no banco ou ajuste os filtros."
          emptyIcon="image"
          meta={meta}
          onPageChange={setPage}
        />
      </Card>

      {/* ------------------------------------------------------------- Modais */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.awaitingConfirmation ? "Confirmar recuperação" : "Detalhes da imagem"}
        size="xl"
        footer={
          selected ? (
            <div className="row row-between row-wrap" style={{ width: "100%" }}>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Fechar
              </Button>
              <div className="row row-2 row-wrap">
                {selected.awaitingConfirmation ? (
                  <>
                    <Button variant="ghost" icon="edit" onClick={() => confirm.mutate({ id: selected.id, action: "keep" })}>
                      Manter antiga
                    </Button>
                    <Button variant="ghost" icon="refresh" onClick={() => recover.mutate(selected.id)} loading={recover.isPending}>
                      Tentar novamente
                    </Button>
                    <Button variant="primary" icon="check" onClick={() => confirm.mutate({ id: selected.id, action: "replace" })} loading={confirm.isPending}>
                      Confirmar recuperação
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" icon="refresh" onClick={() => check.mutate(selected.id)} loading={check.isPending}>
                      Testar URL
                    </Button>
                    {selected.canRecover ? (
                      <Button variant="primary" icon="download" onClick={() => recover.mutate(selected.id)} loading={recover.isPending}>
                        Recuperar imagem
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="stack stack-4">
            <div className="row row-between row-wrap">
              <div>
                <div className="text-strong">{selected.productName ?? selected.label}</div>
                <div className="text-xs text-muted">
                  {TYPE_LABELS[selected.assetType]} • <code>{selected.assetId}</code>
                </div>
              </div>
              <Badge tone={STATUS_TONE[selected.status] ?? "neutral"}>{STATUS_LABELS[selected.status] ?? selected.status}</Badge>
            </div>

            <div className="row row-3 row-wrap" style={{ alignItems: "stretch" }}>
              <div style={{ flex: "1 1 220px" }}>
                <div className="text-xs text-muted mb-1">Imagem atual (antiga)</div>
                <div style={{ background: "var(--color-surface-2)", borderRadius: 10, padding: 8 }}>
                  <Thumb url={selected.currentUrl} alt="Imagem antiga" size={200} />
                </div>
                <div className="text-xs text-muted mt-1" style={{ wordBreak: "break-all" }}>
                  {selected.currentUrl}
                </div>
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <div className="text-xs text-muted mb-1">Imagem recuperada</div>
                <div style={{ background: "var(--color-surface-2)", borderRadius: 10, padding: 8 }}>
                  <Thumb url={selected.newUrl} alt="Imagem recuperada" size={200} />
                </div>
                <div className="text-xs text-muted mt-1" style={{ wordBreak: "break-all" }}>
                  {selected.newUrl ?? "Ainda não recuperada"}
                </div>
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr>
                    <th>URL original</th>
                    <td style={{ wordBreak: "break-all" }}>{selected.originalUrl ?? selected.currentUrl}</td>
                  </tr>
                  <tr>
                    <th>URL nova (Cloudinary)</th>
                    <td style={{ wordBreak: "break-all" }}>{selected.newUrl ?? "—"}</td>
                  </tr>
                  <tr>
                    <th>Provedor / public_id</th>
                    <td>
                      {selected.storageProvider ?? "—"} {selected.publicId ? <code className="text-xs">{selected.publicId}</code> : null}
                    </td>
                  </tr>
                  <tr>
                    <th>Formato / dimensões</th>
                    <td>
                      {selected.format ?? "—"} • {selected.width && selected.height ? `${selected.width}×${selected.height}` : "—"} • {formatBytes(selected.sizeBytes)}
                    </td>
                  </tr>
                  <tr>
                    <th>Verificação</th>
                    <td>
                      HTTP {selected.httpStatus ?? "—"} • tentativas {selected.attempts} • {selected.lastCheckedAt ? formatDateTime(selected.lastCheckedAt) : "nunca"}
                    </td>
                  </tr>
                  {selected.failureReason ? (
                    <tr>
                      <th>Observação</th>
                      <td className="text-sm">{selected.failureReason}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {!selected.awaitingConfirmation ? (
              <div className="stack stack-3">
                <Alert tone="info" title="A imagem original não pôde ser recuperada?">
                  Você pode informar outro endereço ou enviar um arquivo manualmente. Essas ações ficam marcadas como
                  substituta — nunca como “imagem original recuperada”.
                </Alert>
                <div className="row row-2 row-wrap">
                  <div style={{ flex: "1 1 260px" }}>
                    <Input
                      label="Outra URL (http/https)"
                      value={manualUrl}
                      onChange={(event) => setManualUrl(event.target.value)}
                      placeholder="https://…"
                    />
                  </div>
                  <Button
                    variant="subtle"
                    icon="link"
                    disabled={!manualUrl.trim()}
                    loading={submitManualUrl.isPending}
                    onClick={() => submitManualUrl.mutate({ id: selected.id, url: manualUrl.trim() })}
                  >
                    Validar URL
                  </Button>
                </div>
                <div className="row row-2 row-wrap">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) manualUpload.mutate({ id: selected.id, file });
                      event.target.value = "";
                    }}
                  />
                  <Button variant="ghost" icon="upload" onClick={() => fileRef.current?.click()} loading={manualUpload.isPending}>
                    Enviar imagem manualmente
                  </Button>
                  <Button variant="ghost" icon="close" onClick={() => confirm.mutate({ id: selected.id, action: "cancel" })}>
                    Deixar sem imagem por enquanto
                  </Button>
                </div>
              </div>
            ) : (
              <Alert tone="warning" title="Confira se a imagem pertence realmente a este produto">
                A referência antiga só será substituída depois da sua confirmação. Nome, preço, marca, estoque e pedidos não
                são alterados.
              </Alert>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="Recuperar todas as imagens recuperáveis"
        size="md"
        footer={
          <div className="row row-between row-wrap" style={{ width: "100%" }}>
            <Button variant="ghost" onClick={() => setBatchOpen(false)} disabled={startBatch.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" icon="sparkles" onClick={() => startBatch.mutate()} loading={startBatch.isPending}>
              Iniciar recuperação
            </Button>
          </div>
        }
      >
        <div className="stack stack-4">
          <p className="text-sm text-muted">
            Processa APENAS imagens com status <strong>Recuperável</strong> ou <strong>Redirecionamento</strong>, em lotes com
            concorrência limitada. O estado fica salvo no PostgreSQL e continua após um restart do backend (Render). Nada é
            substituído sem confirmação, a menos que você marque a opção abaixo.
          </p>
          {search ? <p className="text-sm text-muted">Busca aplicada: <strong>{search}</strong></p> : null}
          <div className="row row-2 row-wrap">
            <Input
              label="Concorrência (1–8)"
              type="number"
              min={1}
              max={8}
              value={batchConcurrency}
              onChange={(event) => setBatchConcurrency(Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
            />
          </div>
          <Checkbox
            checked={batchAutoConfirm}
            onChange={(event) => setBatchAutoConfirm(event.target.checked)}
            label="Confirmar automaticamente após recuperar (substitui as imagens sem revisão individual)"
          />
          {batchAutoConfirm ? (
            <Alert tone="danger" title="Confirmação automática ativada">
              As imagens acessíveis serão copiadas e substituídas sem pré-visualização. Use somente após conferir a auditoria.
            </Alert>
          ) : (
            <Alert tone="info" title="Pré-visualização em lote">
              Cada imagem recuperada ficará aguardando confirmação. Ao final, confira o lote e clique em “Confirmar lote”.
            </Alert>
          )}
        </div>
      </Modal>
    </div>
  );
}
