import { Link } from "react-router-dom";
import { Icon } from "./Icons";

/**
 * Trilha de navegação (breadcrumbs) — acessível e sem dado inventado:
 * os rótulos vêm sempre das entidades reais (categoria, produto).
 */
export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; to?: string }>;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Você está aqui">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="row row-2">
            {item.to && !isLast ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current={isLast ? "page" : undefined}>{item.label}</span>
            )}
            {!isLast ? (
              <span className="breadcrumbs__sep" aria-hidden="true">
                <Icon name="chevronRight" size={13} />
              </span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
