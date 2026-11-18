# PRO-6 — Dashboard e editor do banco (épico)

Registro de conclusão do épico [PRO-6](/PRO/issues/PRO-6), fechado em 2026-10-20
com as três sub-issues entregues. Este documento amarra o pedido original às
entregas; os detalhes técnicos ficam em [dashboard.md](./dashboard.md) e
[admin.md](./admin.md).

## Pedido original do board

> Um especialista em HTML para gerar dashboards de um banco de dados e criar um
> frontend para visualizar o banco sem o dashboard, para fazer mudanças quando
> precisar.

O épico foi dividido em três etapas sequenciais:

| Issue | Entrega | Documento |
| --- | --- | --- |
| [PRO-7](/PRO/issues/PRO-7) | Scaffold do frontend + conexão com o Postgres | [dashboard.md](./dashboard.md) |
| [PRO-8](/PRO/issues/PRO-8) | Dashboard de conformidade: ensaios × limites por legislação | [dashboard.md](./dashboard.md) |
| [PRO-9](/PRO/issues/PRO-9) | Editor CRUD `/admin` para inspecionar e alterar registros | [PRO-9-editor-crud-admin.md](./PRO-9-editor-crud-admin.md), [admin.md](./admin.md) |

## O que existe hoje

- **App único** em `web/`, auto-suficiente (`package.json`, `.env`,
  `node_modules` próprios), rodando em `http://127.0.0.1:3000`.
- **Dashboard** (`/`): consolidado de conformidade, amostras, série temporal por
  parâmetro, comparativo entre legislações (CONAMA, WHO, EU, EPA), tabela de
  limites e `/health`.
- **Editor** (`/admin`): criação, edição, detalhe e exclusão em duas etapas para
  `pontos`, `amostras`, `parametros`, `resultados`, `leis` e `limites`, com
  validação em português e `READ_ONLY=1` como interruptor de segurança.

## Decisões que valem para os dois lados

- **Stack mínima**: Node ≥ 20, `node:http` + `pg`, HTML renderizado no servidor
  e SVG puro para gráficos. Sem bundler e sem etapa de build; nenhuma
  dependência nova entrou no projeto.
- **A interface não calcula conformidade**: lê `compliance_verdicts` e as views
  `v_compliance_verdicts` / `v_sample_compliance_summary`. As regras oficiais
  são do projeto de dados ([PRO-5](/PRO/issues/PRO-5)).
- **Publicado ≠ normalizado**: limites mostram valor publicado e canônico lado
  a lado; conversão ambígua nunca é adivinhada.
- **Estados distintos**: *Sem limite aplicável* (matriz/data fora da lei) é
  diferente de *Não avaliado* (limite existe, veredito pendente).
- **Exclusão nunca silenciosa**: duas etapas no editor, com aviso de cascata ou
  bloqueio por `RESTRICT`.

## Como rodar e verificar

```bash
cd /home/zanchi/Documents/projetoAplicado/web
npm start          # http://127.0.0.1:3000
npm run check      # sonda /health (sai com 1 se o banco estiver fora)
```

Banco padrão: `waterquality` em `postgres://localhost:5432` via `DATABASE_URL`
no `web/.env`. O app só lê o schema; migrações e seeds pertencem ao projeto de
dados.

## Follow-ups em aberto

- **Serviço no ar**: o processo sobrevive entre sessões com `setsid`, mas não a
  um reboot; o CEO avalia uma forma confiável de subir o app.
- **Sem autenticação/CSRF**: uso local em `127.0.0.1`; proteger antes de expor.
- **Dados de demonstração**: `samples`/`results` reais ainda não existem; o
  `demo:seed` só roda com `samples` vazia, então não inserir linhas de teste
  permanentes.
- **Conformidade do consolidado**: ~~WHO/EU/EPA julgam água bruta contra limites
  de água de consumo enquanto `applies_to_matrix` estiver nulo; correção em
  [PRO-13](/PRO/issues/PRO-13)~~ — **resolvido em
  [PRO-13](/PRO/issues/PRO-13)** (escopo `tap` nas 135 linhas, coluna
  `NOT NULL`, predicado único `limit_applies_to_matrix()`): água superficial
  agora lê *Sem limite aplicável* para WHO/EU/EPA.
