import { useEffect } from "react";
import { CatalogView } from "@/components/product/CatalogView";
import { applySeo } from "@/lib/seo";

export default function ProductsPage() {
  useEffect(() => {
    applySeo({
      title: "Todos os produtos",
      description: "Explore o catálogo completo da loja: perfumes importados, árabes, decants, contratipos e kits.",
      canonicalPath: "/produtos",
    });
  }, []);

  return <CatalogView title="Todos os produtos" subtitle="Use os filtros para encontrar o perfume ideal." />;
}
