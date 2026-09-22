# Importação de catálogo

Fonte de referência: **https://www.mastoree.com.br/** (dados públicos, sem invenção).
`mastoree-listing.json` contém 42 produtos reais extraídos da listagem oficial
(nome e preço). Campos como marca/categoria/imagem podem ser enriquecidos depois.

## Segurança
- **Dry-run por padrão** — nada é gravado sem `--apply`.
- **Nunca apaga** produtos existentes.
- Detecta duplicidade por SKU, slug e nome.
- Sinaliza **preço divergente** para revisão.
- Produtos novos entram **INATIVOS** e com estoque 0 (revisar no painel).

## Comandos
```bash
# só valida o arquivo (não acessa o banco)
npm run catalog:validate -- --file=catalog/mastoree-listing.json

# gera o relatório de diff (dry-run) — exige DATABASE_URL
npm run catalog:import -- --file=catalog/mastoree-listing.json

# aplica (cria inativos; não atualiza preço a menos que autorizado)
npm run catalog:import -- --file=catalog/mastoree-listing.json --apply

# atualizando preços também (comparar antes!)
npm run catalog:import -- --file=catalog/mastoree-listing.json --apply --update-prices
```

O relatório é salvo em `catalog/import-report.json`.

## Formato aceito
```json
[
  {
    "nome": "Perfume Asad Bourbon Árabe Original – 100ml",
    "preco": 380,
    "preco_antigo": 400,
    "sku": "opcional",
    "slug": "opcional",
    "marca": "Lattafa",
    "categoria": "Perfumes",
    "volume": "100ml",
    "peso_gramas": 350,
    "imagem": "https://..."
  }
]
```
