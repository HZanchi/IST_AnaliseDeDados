# Projeto IST — dashboard de conformidade

Dashboard HTML que mostra resultados de ensaio de qualidade de água contra os
limites das legislações carregadas (CONAMA, WHO, EU, EPA), com veredito de
conformidade amostra por amostra. Interface em **português**.

Documentação completa: [`../docs/dashboard.md`](../docs/dashboard.md) (dashboard)
e [`../docs/admin.md`](../docs/admin.md) (editor `/admin`).

## Rodar

```bash
npm install
npm start          # http://127.0.0.1:3000
npm run check      # sonda /health (JSON) — sai com 1 se o banco estiver fora
```

Banco: `DATABASE_URL` em `.env` (padrão `postgres://localhost:5432/waterquality`).
Migrações/seeds não são daqui — rodam no projeto de dados
(`npm run db:setup`).

## Rotas principais

- `/` visão geral e consolidado de conformidade
- `/amostras` e `/amostras/:code` — lista e detalhe com pass/fail por resultado
- `/amostras/:code/relatorio` — relatório de ensaio por amostra (resumo,
  resultados, comparativo entre leis, legenda, citações); `?lei=<código>` troca
  a lei vinculante e `?lei=nenhuma` emite sem conclusão geral
- `/resultados?param=code` — série temporal com as linhas de limite (SVG)
- `/comparativo?param=code` — parâmetro × legislações (publicado vs normalizado)
- `/limites?lei=code` — tabela de limites por legislação
- `/health` — JSON de saúde
- `/admin` e `/admin/:entidade` — editor CRUD (criar, editar, excluir com
  confirmação); `READ_ONLY=1 npm start` desliga a escrita (403)

## Dados de demonstração

```bash
npm run demo:seed     # só insere se não houver amostras; marca tudo como demo
npm run demo:purge    # remove somente os dados de demonstração
```

## Stack

Node ≥ 20 · `node:http` · `pg` · HTML renderizado no servidor · SVG puro para
gráficos. Sem bundler e sem etapa de build.
