# PRO-9 — Editor CRUD `/admin` (Projeto IST)

Registro de conclusão da issue [PRO-9](/PRO/issues/PRO-9) (épico
[PRO-6](/PRO/issues/PRO-6)), aprovada pelo CEO e pelo board e concluída em
2026-10-20. Referência técnica completa: [admin.md](./admin.md).

## Objetivo

O board pediu uma interface, separada do dashboard, para **inspecionar e editar
o banco diretamente** — cadastrar dados reais sem depender de SQL. Critérios da
issue: validação básica, nenhuma exclusão silenciosa e interface em português.
Pronto = mudanças feitas na tela persistem no Postgres.

## O que foi entregue

- Seção `/admin` no app existente (`web/`), SSR como o restante do projeto,
  **sem dependência nova** e com rótulos em pt-BR (`<html lang="pt-BR">`).
- **6 entidades editáveis**: `pontos`, `amostras`, `parametros`, `resultados`,
  `leis`, `limites`. `compliance_verdicts` fica fora de propósito: é derivada.
- **Rotas**: painel com contagens; listagem com busca (`?busca=`) e paginação
  (`?pagina=`); criação e edição com PRG (`303` + `?flash=`); detalhe com
  dependências; exclusão em **duas etapas** (`GET .../excluir` mostra o impacto,
  `POST` confirma).
- **Validação em duas camadas**: mensagens em português no servidor
  (obrigatórios, unicidade de código, opções de `select`, faixas dos `CHECK`,
  precedência de datas, regras de `limit_kind`) + tradução dos erros do
  Postgres (`23505/23503/23514/23502/22P02`) como rede de segurança. Erros
  voltam como `422` preservando o valor digitado.
- **Modo leitura** opcional com `READ_ONLY=1`: esconde botões de escrita,
  redireciona formulários e recusa todo `POST` com `403`.

## Arquitetura e decisões

- **Configuração declarativa por entidade** (`web/lib/entities.mjs`): uma única
  definição alimenta listagem, formulário e validação das seis entidades.
- **Três decisões de integridade**:
  1. **Escrita total com interruptor de leitura** — o objetivo da issue é
     persistir no Postgres; o custo é confiar na validação, por isso ela é dupla
     e toda exclusão exige confirmação.
  2. **Exclusão nunca silenciosa** — duas etapas com contagem do impacto:
     `CASCADE` avisa antes; `RESTRICT` desabilita o botão e devolve `409` com a
     explicação, sem apagar nada.
  3. **Veredito obsoleto é aposentado, não reaproveitado** — editar resultado ou
     limite grava `superseded_at = now()` nos vereditos ativos afetados; as
     vistas filtram essas linhas e a UI mostra *Não avaliado* até o recálculo
     oficial ([PRO-5](/PRO/issues/PRO-5)).
- **Unidade canônica ambígua** não é adivinhada: com
  `conversion_status = 'ambiguous'` o formulário recusa preencher o valor
  canônico e exige a nota de conversão.

## Arquivos-chave

```
web/routes/admin.mjs      rotas, PRG, 403/409, tratamento de erro
web/lib/entities.mjs      configuração e validações das 6 entidades
web/lib/crud.mjs          coerção, SQL, unicidade, mapa de erros do Postgres
web/lib/forms.mjs         campos e mensagens de erro
web/pages/admin_list.mjs  painel, listagem, busca e paginação
web/pages/admin_form.mjs  formulário, detalhe e confirmação de exclusão
web/public/styles.css     bloco visual do editor
```

## Como rodar e verificar

```bash
cd /home/zanchi/Documents/projetoAplicado/web
npm start                 # http://127.0.0.1:3000/admin
READ_ONLY=1 npm start     # modo leitura (POST → 403)
```

Verificação usada na entrega:

- `/health` → `200`; `/admin`, `/admin/amostras`, `/admin/pontos` → `200`;
  registro inexistente e rota desconhecida → `404`.
- Ciclo criar → editar → excluir em qualquer entidade, conferindo a linha no
  Postgres.
- Código duplicado → `422`; `latitude=999` → `422` com mensagem de faixa.
- Exclusão em duas etapas: cascata confirmada na amostra; ponto com amostras
  devolve `409` e preserva os dados.
- `READ_ONLY=1`: banner nos formulários e todo `POST` bloqueado.

Estado do banco no fechamento (baseline, sem artefatos de teste):
3 pontos · 12 amostras · 132 resultados · 388 vereditos · 172 limites · 4 leis.
(Desde [PRO-13](/PRO/issues/PRO-13) o banco tem **188 vereditos ativos**: os
200 que julgavam matriz não coberta foram superados na migração `0005`.)

## Limitações da v1

- Sem autenticação/autorização e sem token CSRF; o servidor escuta em
  `127.0.0.1` por padrão. Expor em rede exige uma camada de proteção.
- Sem edição em massa e sem importação de CSV (o seed do projeto de dados é o
  caminho para volume).
- Campos `metadata` (JSON) não são editáveis — preservados como estão.
- Vereditos não são recalculados pelo editor.

## Follow-ups em aberto

- **Conformidade do consolidado**: ~~WHO/EU/EPA ainda julgam água bruta contra
  limites de água de consumo porque `applies_to_matrix` está nulo nas linhas de
  limite; correção em [PRO-13](/PRO/issues/PRO-13)~~ — **resolvido em
  [PRO-13](/PRO/issues/PRO-13)**: a coluna é `NOT NULL` com escopo por linha
  (`tap`/`surface`), o casamento matriz×limite passa por
  `limit_applies_to_matrix()` e o editor exige escopo no formulário de limite
  (opção “Todas as matrizes (deliberado)” = `any`). Não é problema do editor.
- **Serviço não sobrevive a reboot**: hoje sobe manualmente (ou via `setsid`);
  o CEO avalia uma forma confiável de manter o app no ar.
- Proteção de acesso antes de qualquer exposição fora de `127.0.0.1`.
