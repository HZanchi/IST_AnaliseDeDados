# Editor de dados (`/admin`) — CRUD no Postgres

Área de edição do app em [`../web/`](../web/). Inspeciona e altera as tabelas do
banco de qualidade da água pela interface, sem linha de comando. Entrega da
tarefa [PRO-9](../../) (CRUD editor UI).

## Rodar

```bash
cd ../web && npm start        # http://127.0.0.1:3000 → "Editar dados" no menu
READ_ONLY=1 npm start         # modo leitura: escrita recusada (403)
```

O editor usa a mesma conexão do dashboard (`DATABASE_URL` no `.env` do `web/`).
**Não há autenticação**: por padrão o servidor escuta só em `127.0.0.1`, então o
acesso é local à máquina. Em rede, é responsabilidade de quem expuser o serviço.

## Rotas

| Rota | O que faz |
| --- | --- |
| `GET /admin` | painel com as seis entidades e contagem de registros |
| `GET /admin/:entidade` | listagem com busca (`?busca=`) e paginação (`?pagina=`) |
| `GET /admin/:entidade/novo` | formulário de criação |
| `POST /admin/:entidade` | grava o novo registro → `303` com `?flash=criado` |
| `GET /admin/:entidade/:id` | detalhe do registro + dependências para exclusão |
| `GET /admin/:entidade/:id/editar` | formulário de edição |
| `POST /admin/:entidade/:id` | grava as alterações → `303` com `?flash=atualizado` |
| `GET /admin/:entidade/:id/excluir` | **etapa 1**: mostra impacto e pede confirmação |
| `POST /admin/:entidade/:id/excluir` | **etapa 2**: executa a exclusão → `303` com `?flash=excluido` |

`:entidade` ∈ `pontos`, `amostras`, `parametros`, `resultados`, `leis`, `limites`
(os dois primeiros e `leis`/`parametros` existem porque são alvo de chave
estrangeira de amostras e limites).

## O que valida

Duas camadas, nenhuma falha em silêncio:

1. **Servidor (mensagens em português)** — obrigatórios, unicidade de código,
   valores de `select` contra as opções carregadas do banco, faixas dos `CHECK`
   do esquema (profundidade ≥ 0, temperatura −20…100 °C, volume > 0, latitude e
   longitude, réplica ≥ 1, taxa 0…1), precedência de datas (recebida ≥ coletada,
   laudo ≥ medida, vigência até ≥ de) e as regras de `limit_kind` (máx/mín, faixa
   e textual exigem a combinação certa de valores publicados × canônicos).
2. **Banco (rede de segurança)** — `23505` duplicidade, `23503` chave
   estrangeira, `23514` verificação, `23502` not-null, `22P02`/`22001` tipo e
   tamanho são traduzidos em texto legível (mapa em `lib/crud.mjs`).

Erros re-renderizam o formulário com `422`, preservando o que foi digitado.

## Exclusão nunca é silenciosa

Duas etapas obrigatórias: a `GET .../excluir` lista **o que será afetado** com a
contagem e o comportamento declarado no esquema:

- **cascata** (`ON DELETE CASCADE`) — ex.: apagar amostra apaga os resultados e
  vereditos dela; a página avisa antes;
- **restrição** (`ON DELETE RESTRICT`) — ex.: ponto de coleta com amostras ou
  limite com vereditos; o botão fica desabilitado e o `POST` devolve `409` com a
  explicação. Nada é apagado.

Não existe exclusão em massa nem atalho sem confirmação.

## Vereditos e integridade

- **Editar um resultado ou um limite** aposenta os vereditos ativos afetados
  (`compliance_verdicts.superseded_at = now()`). As vistas filtram
  `superseded_at IS NULL`, então a UI mostra *Não avaliado* em vez de um
  pass/fail que já não corresponde ao dado. O recálculo é papel do avaliador
  oficial do projeto de dados ([PRO-5]).
- **Veredito não é editável pela interface**: é derivado. A tabela
  `compliance_verdicts` não aparece no editor de propósito.
- **Unidade e canônico** seguem a diretriz do esquema: com
  `conversion_status = 'ambiguous'` o valor canônico fica nulo por construção —
  o formulário **recusa** preenchê-lo e exige a nota de conversão.

## Modo leitura (`READ_ONLY=1`)

Interruptor de segurança previsto na tarefa: com a variável ligada, o editor
mostra o banner, esconde os botões de escrita, o `GET .../novo` e o `GET
.../editar` redirecionam para a página de detalhe e **todo `POST` responde
`403`**. É a opção para arriscar menos quando a escrita direta não for
desejada; desligue removendo a variável do `.env`.

*Tradeoff registrado*: a escrita total é justamente o que a tarefa pede
("mudanças persistem no Postgres") — o custo é confiar na validação, por isso
ela é dupla (aplicação + banco) e toda exclusão passa por confirmação.

## Arquivos

```
web/routes/admin.mjs      rotas, validação de envio, PRG com flash, 403/409
web/lib/entities.mjs      configuração declarativa das 6 entidades + validações
web/lib/crud.mjs          coerção de campos, SQL, unicidade, mapa de erros PG
web/lib/forms.mjs         renderização de campos e erros do formulário
web/pages/admin_list.mjs  painel + listagem (busca, paginação, ações)
web/pages/admin_form.mjs  formulário, detalhe e confirmação de exclusão
web/public/styles.css     bloco “editor CRUD” ao final do arquivo
```

## Limitações v1

- sem autenticação/autorização (só `127.0.0.1` por padrão) e sem token CSRF —
  quem expuser o serviço em rede precisa por isso na frente;
- sem edição em massa, sem importação de CSV (o seed do projeto de dados é o
  caminho para volume);
- `metadata` (JSON) das tabelas não é exposto no formulário — preservado como
  está;
- vereditos não são recalculados (v. acima) e a exclusão de limite com vereditos
  depende de resolver esses registros antes.

[PRO-5]: (issue do projeto de dados)
