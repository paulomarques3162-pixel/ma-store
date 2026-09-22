import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Icon,
  Input,
  LoadingBlock,
  Select,
  Switch,
} from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors, uploadImage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import type { Brand, Category, Product } from "@/types/api";

type FormState = {
  name: string;
  sku: string;
  shortDescription: string;
  description: string;
  brandId: string;
  categoryId: string;
  price: string;
  comparePrice: string;
  costPrice: string;
  volume: string;
  weightGrams: string;
  stock: string;
  minStock: string;
  hasShipping: boolean;
  allowCoupon: boolean;
  isLaunch: boolean;
  isFeatured: boolean;
  isBestSeller: boolean;
  active: boolean;
  metaTitle: string;
  metaDescription: string;
  images: Array<{ url: string; alt: string; position: number; focalPoint: string }>;
};

/** Presets de enquadramento (object-position) para as imagens do produto. */
const FOCAL_POINTS = [
  { value: "center", label: "Centro" },
  { value: "top", label: "Topo" },
  { value: "bottom", label: "Base" },
  { value: "left", label: "Esquerda" },
  { value: "right", label: "Direita" },
  { value: "50% 25%", label: "Acima do centro" },
  { value: "50% 75%", label: "Abaixo do centro" },
  { value: "25% 50%", label: "Foco à esquerda" },
  { value: "75% 50%", label: "Foco à direita" },
];

const EMPTY_FORM: FormState = {
  name: "",
  sku: "",
  shortDescription: "",
  description: "",
  brandId: "",
  categoryId: "",
  price: "",
  comparePrice: "",
  costPrice: "",
  volume: "",
  weightGrams: "",
  stock: "0",
  minStock: "0",
  hasShipping: true,
  allowCoupon: true,
  isLaunch: false,
  isFeatured: false,
  isBestSeller: false,
  active: true,
  metaTitle: "",
  metaDescription: "",
  images: [],
};

/** Cadastro e edição de produto (mesma tela para criar e editar). */
export default function AdminProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const saved = await uploadImage(file);
        setForm((current) => ({
          ...current,
          images: [
            ...current.images,
            { url: saved.url, alt: current.name, position: current.images.length, focalPoint: "center" },
          ],
        }));
      }
      toast.success("Imagem(ns) enviada(s)");
    } catch (uploadError) {
      toast.error("Não foi possível enviar a imagem", errorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    applySeo({
      title: isEditing ? "Editar produto" : "Novo produto",
      noindex: true,
      canonicalPath: isEditing ? `/admin/produtos/${id}` : "/admin/produtos/novo",
    });
  }, [isEditing, id]);

  const product = useQuery({
    queryKey: queryKeys.adminProduct(id ?? ""),
    queryFn: () => api.get<Product & { images: Array<{ id: string; url: string; alt: string | null; position: number }> }>(`/admin/products/${id}`),
    enabled: isEditing,
  });

  const categories = useQuery({ queryKey: queryKeys.adminCategories, queryFn: () => api.get<Category[]>("/admin/categories") });
  const brands = useQuery({ queryKey: queryKeys.adminBrands, queryFn: () => api.get<Brand[]>("/admin/brands") });

  useEffect(() => {
    if (!product.data) return;
    const data = product.data;
    setForm({
      name: data.name,
      sku: data.sku,
      shortDescription: data.shortDescription ?? "",
      description: data.description ?? "",
      brandId: data.brandId ?? "",
      categoryId: data.categoryId ?? "",
      price: String(data.price),
      comparePrice: data.comparePrice ? String(data.comparePrice) : "",
      costPrice: data.costPrice ? String(data.costPrice) : "",
      volume: data.volume ?? "",
      weightGrams: data.weightGrams ? String(data.weightGrams) : "",
      stock: String(data.stock),
      minStock: String(data.minStock ?? 0),
      hasShipping: data.hasShipping,
      allowCoupon: data.allowCoupon,
      isLaunch: data.isLaunch,
      isFeatured: data.isFeatured,
      isBestSeller: data.isBestSeller,
      active: data.active,
      metaTitle: data.metaTitle ?? "",
      metaDescription: data.metaDescription ?? "",
      images: (data.images ?? []).map((image, index) => ({
        url: image.url,
        alt: image.alt ?? "",
        position: image.position ?? index,
        focalPoint: image.focalPoint ?? "center",
      })),
    });
  }, [product.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        shortDescription: form.shortDescription || undefined,
        description: form.description || undefined,
        brandId: form.brandId || null,
        categoryId: form.categoryId || null,
        price: Number(form.price),
        comparePrice: form.comparePrice ? Number(form.comparePrice) : undefined,
        costPrice: form.costPrice ? Number(form.costPrice) : undefined,
        volume: form.volume || undefined,
        weightGrams: form.weightGrams ? Number(form.weightGrams) : undefined,
        stock: Number(form.stock),
        minStock: Number(form.minStock),
        hasShipping: form.hasShipping,
        allowCoupon: form.allowCoupon,
        isLaunch: form.isLaunch,
        isFeatured: form.isFeatured,
        isBestSeller: form.isBestSeller,
        active: form.active,
        metaTitle: form.metaTitle || undefined,
        metaDescription: form.metaDescription || undefined,
        images: form.images.map((image, index) => ({
          url: image.url,
          alt: image.alt || undefined,
          position: index,
          focalPoint: image.focalPoint || "center",
        })),
      };

      return isEditing
        ? api.patch<Product>(`/admin/products/${id}`, payload)
        : api.post<Product>("/admin/products", payload);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      toast.success(isEditing ? "Produto atualizado" : "Produto criado", saved.name);
      navigate("/admin/produtos");
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error("Não foi possível salvar", errorMessage(error));
    },
  });

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next["name"] = "Informe o nome do produto.";
    if (!form.sku.trim()) next["sku"] = "Informe o SKU.";
    if (!form.price || Number(form.price) <= 0) next["price"] = "Informe um preço válido.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  if (isEditing && product.isLoading) return <LoadingBlock label="Carregando produto…" />;

  if (isEditing && product.error) {
    return (
      <Alert tone="danger" title="Produto não encontrado">
        {errorMessage(product.error)}
        <div className="mt-2">
          <Link to="/admin/produtos" className="btn btn--ghost btn--sm">
            Voltar para a lista
          </Link>
        </div>
      </Alert>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div>
      <AdminPageHeader
        title={isEditing ? "Editar produto" : "Novo produto"}
        subtitle="Preencha apenas informações reais. Produtos inativos não aparecem na loja."
        actions={
          <>
            <Link to="/admin/produtos" className="btn btn--ghost">
              <Icon name="arrowLeft" size={16} /> Voltar
            </Link>
            <Button loading={save.isPending} onClick={() => validate() && save.mutate()} icon="check">
              {isEditing ? "Salvar alterações" : "Criar produto"}
            </Button>
          </>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", alignItems: "start" }}>
        <div className="stack stack-5">
          <Card className="stack stack-4">
            <h3 className="card__title">Informações principais</h3>

            <Input
              label="Nome do produto"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              error={errors["name"]}
              required
            />

            <Input
              label="SKU"
              value={form.sku}
              onChange={(event) => set("sku", event.target.value)}
              error={errors["sku"]}
              hint="Código único de controle interno."
              required
            />

            <Input
              label="Descrição curta"
              value={form.shortDescription}
              onChange={(event) => set("shortDescription", event.target.value)}
              hint="Aparece na vitrine e nos resultados de busca."
            />

            <div className="field">
              <label className="field__label" htmlFor="description">
                Descrição completa
              </label>
              <textarea
                id="description"
                className="textarea"
                style={{ minHeight: 160 }}
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                placeholder="Detalhes reais do produto"
              />
            </div>
          </Card>

          <Card className="stack stack-4">
            <h3 className="card__title">Preço e estoque</h3>

            <div className="grid grid-cols-2 grid-2">
              <Input
                label="Preço de venda"
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(event) => set("price", event.target.value)}
                error={errors["price"]}
                required
              />
              <Input
                label="Preço comparativo"
                type="number"
                step="0.01"
                min="0"
                value={form.comparePrice}
                onChange={(event) => set("comparePrice", event.target.value)}
                hint="Só preencha se houver promoção real."
              />
            </div>

            <Input
              label="Custo (interno)"
              type="number"
              step="0.01"
              min="0"
              value={form.costPrice}
              onChange={(event) => set("costPrice", event.target.value)}
              hint="Nunca é exibido para o cliente."
            />

            <div className="grid grid-2">
              <Input
                label="Estoque disponível"
                type="number"
                min="0"
                value={form.stock}
                onChange={(event) => set("stock", event.target.value)}
              />
              <Input
                label="Estoque mínimo"
                type="number"
                min="0"
                value={form.minStock}
                onChange={(event) => set("minStock", event.target.value)}
                hint="Dispara alerta no dashboard."
              />
            </div>

            <div className="row row-4 row-wrap">
              <Switch label="Possui frete" checked={form.hasShipping} onChange={(value) => set("hasShipping", value)} />
              <Switch label="Permite cupom" checked={form.allowCoupon} onChange={(value) => set("allowCoupon", value)} />
            </div>
          </Card>
        </div>

        <div className="stack stack-5">
          <Card className="stack stack-4">
            <h3 className="card__title">Organização</h3>

            <Select
              label="Categoria"
              value={form.categoryId}
              onChange={(event) => set("categoryId", event.target.value)}
              placeholder="Sem categoria"
              options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))}
            />

            <Select
              label="Marca"
              value={form.brandId}
              onChange={(event) => set("brandId", event.target.value)}
              placeholder="Sem marca"
              options={(brands.data ?? []).map((brand) => ({ value: brand.id, label: brand.name }))}
            />

            <Input
              label="Volume"
              value={form.volume}
              onChange={(event) => set("volume", event.target.value)}
              placeholder="Ex.: 100ml"
            />

            <Input
              label="Peso (gramas)"
              type="number"
              min="0"
              value={form.weightGrams}
              onChange={(event) => set("weightGrams", event.target.value)}
              hint="Usado no cálculo de frete."
            />
          </Card>

          <Card className="stack stack-4">
            <h3 className="card__title">Destaques na loja</h3>
            <Checkbox
              label="Lançamento"
              checked={form.isLaunch}
              onChange={(event) => set("isLaunch", event.target.checked)}
            />
            <Checkbox
              label="Destaque na home"
              checked={form.isFeatured}
              onChange={(event) => set("isFeatured", event.target.checked)}
            />
            <Checkbox
              label="Mais vendido (marcação manual)"
              checked={form.isBestSeller}
              onChange={(event) => set("isBestSeller", event.target.checked)}
              hint="A seção “Mais vendidos” também é alimentada por vendas reais."
            />
            <Checkbox
              label="Produto ativo (visível na loja)"
              checked={form.active}
              onChange={(event) => set("active", event.target.checked)}
            />
          </Card>

          <Card className="stack stack-4">
            <h3 className="card__title">Imagens</h3>
            <Alert tone="info">
              Informe a URL de imagens **reais** do produto. Sem imagem cadastrada, a loja exibe um placeholder —
              nunca uma foto genérica.
            </Alert>

            <div className="row row-2">
              <Input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://…/imagem.jpg"
                aria-label="URL da imagem"
              />
              <Button
                variant="ghost"
                icon="plus"
                onClick={() => {
                  if (!imageUrl.trim()) return;
                  setForm((current) => ({
                    ...current,
                    images: [
                      ...current.images,
                      { url: imageUrl.trim(), alt: current.name, position: current.images.length, focalPoint: "center" },
                    ],
                  }));
                  setImageUrl("");
                }}
              >
                Adicionar
              </Button>
            </div>

            <div className="stack stack-2">
              <label className="field__label" htmlFor="product-image-upload">
                Enviar imagem do computador (JPEG, PNG, WEBP, GIF ou AVIF — até 5 MB)
              </label>
              <input
                id="product-image-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                multiple
                disabled={uploading}
                onChange={(event) => {
                  void handleUpload(event.target.files);
                  event.target.value = "";
                }}
              />
              {uploading ? <p className="text-xs text-muted">Enviando…</p> : null}
            </div>

            {form.images.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma imagem cadastrada.</p>
            ) : (
              <div className="stack stack-2">
                {form.images.map((image, index) => (
                  <div key={`${image.url}-${index}`} className="stack stack-3 option-item" style={{ cursor: "default" }}>
                    <div className="row row-3 row-between" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
                      <span className="row row-3" style={{ minWidth: 0 }}>
                        <span style={{ width: 56, height: 56, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "var(--color-surface-2)" }}>
                          <img
                            src={image.url}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: image.focalPoint || "center" }}
                          />
                        </span>
                        <span className="text-xs truncate" style={{ maxWidth: 200 }}>
                          {index === 0 ? "Capa • " : ""}
                          {image.url}
                        </span>
                      </span>

                      <span className="row row-2" style={{ flexWrap: "wrap" }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="arrowUp"
                          iconOnly
                          disabled={index === 0}
                          aria-label="Mover imagem para cima"
                          onClick={() =>
                            setForm((current) => {
                              const next = [...current.images];
                              const [item] = next.splice(index, 1);
                              if (item) next.splice(index - 1, 0, item);
                              return { ...current, images: next };
                            })
                          }
                        >
                          Subir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="arrowDown"
                          iconOnly
                          disabled={index === form.images.length - 1}
                          aria-label="Mover imagem para baixo"
                          onClick={() =>
                            setForm((current) => {
                              const next = [...current.images];
                              const [item] = next.splice(index, 1);
                              if (item) next.splice(index + 1, 0, item);
                              return { ...current, images: next };
                            })
                          }
                        >
                          Descer
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() =>
                            setForm((current) => {
                              const next = [...current.images];
                              const [item] = next.splice(index, 1);
                              if (item) next.unshift(item);
                              return { ...current, images: next };
                            })
                          }
                        >
                          Definir capa
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="trash"
                          iconOnly
                          onClick={() => setForm((current) => ({ ...current, images: current.images.filter((_, i) => i !== index) }))}
                        >
                          Remover
                        </Button>
                      </span>
                    </div>

                    <Select
                      label={`Enquadramento da imagem ${index + 1}`}
                      value={image.focalPoint || "center"}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          images: current.images.map((entry, i) =>
                            i === index ? { ...entry, focalPoint: event.target.value } : entry,
                          ),
                        }))
                      }
                      options={FOCAL_POINTS}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="stack stack-4">
            <h3 className="card__title">SEO (opcional)</h3>
            <Input
              label="Título para buscadores"
              value={form.metaTitle}
              onChange={(event) => set("metaTitle", event.target.value)}
              hint="Em branco, usamos o nome do produto."
            />
            <Input
              label="Descrição para buscadores"
              value={form.metaDescription}
              onChange={(event) => set("metaDescription", event.target.value)}
            />
          </Card>
        </div>
      </div>

      <div className="row row-end mt-6">
        <Button size="lg" loading={save.isPending} onClick={() => validate() && save.mutate()} icon="check">
          {isEditing ? "Salvar alterações" : "Criar produto"}
        </Button>
      </div>
    </div>
  );
}
