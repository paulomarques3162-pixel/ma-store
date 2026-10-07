import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs, ErrorState, Skeleton } from "@/components/ui";
import { CatalogView } from "@/components/product/CatalogView";
import { useCategory } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { errorMessage, errorRequestId } from "@/lib/api";

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: category, isLoading, error, refetch } = useCategory(slug);

  useEffect(() => {
    if (!category) return;
    applySeo({
      title: category.name,
      description: category.description ?? undefined,
      canonicalPath: `/categoria/${category.slug}`,
    });
  }, [category]);

  if (isLoading) {
    return (
      <div className="container">
        <Skeleton height={28} width="40%" style={{ marginTop: 32 }} />
        <Skeleton height={16} width="60%" style={{ marginTop: 12 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-8">
        <ErrorState
          title="Categoria não encontrada"
          message={errorMessage(error)}
          requestId={errorRequestId(error)}
          onRetry={() => void refetch()}
        />
        <div className="text-center">
          <Link to="/produtos" className="btn btn--ghost">
            Ver todos os produtos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="container">
        <Breadcrumbs
          items={[
            { label: "Início", to: "/" },
            { label: "Produtos", to: "/produtos" },
            { label: category?.name ?? "" },
          ]}
        />
      </div>

      <CatalogView
        title={category?.name ?? "Categoria"}
        subtitle={category?.description ?? undefined}
        lockedCategory={slug}
      />
    </>
  );
}
