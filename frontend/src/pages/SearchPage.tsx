import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CatalogView } from "@/components/product/CatalogView";
import { applySeo } from "@/lib/seo";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const term = searchParams.get("q") ?? "";

  useEffect(() => {
    applySeo({
      title: term ? `Busca: ${term}` : "Buscar produtos",
      description: term ? `Resultados da busca por "${term}".` : "Busque por nome, marca ou categoria.",
      canonicalPath: term ? `/buscar?q=${encodeURIComponent(term)}` : "/buscar",
      noindex: true,
    });
  }, [term]);

  return (
    <CatalogView
      title={term ? `Resultados para "${term}"` : "Buscar produtos"}
      subtitle="Refine a busca com os filtros ao lado."
      initialSearch={term}
    />
  );
}
