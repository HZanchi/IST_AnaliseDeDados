# Dashboard de conformidade — qualidade da água

Aplicação HTML que cruza os **resultados de ensaio** com os **limites de cada
legislação** (CONAMA, WHO, EU, EPA) e mostra a situação de conformidade
amostra por amostra. Faz parte do Projeto IST e fica nesta pasta
(`projetoAplicado/web/`), a pedido do board.

## Como rodar

```bash
cd projetoAplicado/web
npm install        # primeira vez
npm start          # http://127.0.0.1:3000
```

Outros comandos:

```bash
npm run check          # sonda /health em JSON (sai com 1 se o banco estiver fora)
npm run demo:seed      # carrega dados de demonstração (só se samples estiver vazia)
npm run demo:purge     # remove exatamente os dados de demonstração
```

Configuração em `web/.env`:

```
DATABASE_URL=postgres://localhost:5432/waterquality
PORT=3000            # opcional
HOST=127.0.0.1       # opcional
```

O banco é criado, migrado e populado pelo projeto de dados (pasta
`waterquality-db` do workspace de dados do onboarding): `npm run db:setup`.
O dashboard só **lê** esse banco — ele não tem migrações próprias.

## Rotas

| Rota | O que mostra |
| --- | --- |
| `/` | Visão geral: conexão, indicadores (amostras, resultados, vereditos, limites), consolidado de conformidade, amostras recentes e últimos vereditos |
| `/amostras` | Lista de amostras com situação consolidada, cobertura de limites e selo por legislação; filtros por situação e matriz |
| `/amostras/:code` | Detalhe da amostra: cada resultado com os limites aplicáveis e o veredito (ou o motivo de ainda não ter veredito) |
| `/amostras/:code/relatorio?lei=code` | Relatório de ensaio por amostra (contrato PRO-5): resumo por lei, tabela de resultados, comparativo entre legislações, legenda, citações e regras compostas. `lei` = lei vinculante da conclusão (padrão CONAMA-357-2005; `nenhuma` = sem conclusão geral) |
| `/resultados?param=code` | Série temporal de um parâmetro com as linhas dos limites das legislações sobrepostas (SVG gerado no servidor) |
| `/comparativo?param=code` | Um parâmetro × todas as legislações: valor **publicado** vs valor **normalizado**, abrangência, conversão, citação e os resultados medidos |
| `/limites?lei=code&param=code` | Tabela de `legislation_limits` com volume por lei e filtro por legislação/parâmetro |
| `/health` | JSON de saúde (HTTP 200 com banco OK, 503 sem) |
| `/styles.css` | A folha de estilos |

Rotas desconhecidas e registros inexistentes devolvem 404 com página em
português; erro de handler devolve 500.

## Onde os dados vêm de

- `samples`, `results`, `sampling_points`, `test_parameters` — ensaios e catálogo.
- `legislations`, `legislation_limits` — as leis e seus limites
  (`published_*` = como a lei publicou; `limit_value`/`unit` = canônico, para
  comparar com o resultado).
- `compliance_verdicts` — vereditos gravados (uma linha viva por
  resultado × limite; reavaliação supersede em vez de sobrescrever).
- Views `v_compliance_verdicts` (vereditos com join completo) e
  `v_sample_compliance_summary` (consolidado amostra × legislação).

## Regras de leitura usadas na interface

1. **Consolidado por amostra** — qualquer veredito `non_compliant` torna a
   amostra *Não conforme*; `indeterminate` tem prioridade sobre `compliant`;
   sem veredito mas com limite aplicável → *Não avaliado*.
2. **Sem limite aplicável** — quando nenhuma lei carregada cobre a matriz/data
   da amostra (ex.: CONAMA 357/2005 vale para água superficial, então amostras
   de água tratada aparecem assim — e o inverso também vale desde PRO-13:
   superfície não tem limite em WHO/EU/EPA, leis de água de consumo). Isso é a
   regra de matriz do esquema funcionando, não um erro de dados.
3. **Publicado ≠ normalizado** — a interface mostra os dois lado a lado e o
   estado da conversão (`exata`/`convertida`/`ambígua`). Conversões ambíguas
   ficam com o valor canônico nulo no banco e jamais são adivinhadas.
4. **Vereditos oficiais vêm do banco** — a interface não calcula conformidade
   por conta própria; ela lê `compliance_verdicts`. As regras oficiais de
   cálculo são responsabilidade do projeto de dados.

## Dados de demonstração

O banco não tinha amostras/resultados (só catálogo e limites), o que deixaria
o dashboard sem nada de "conformidade por amostra" para ler. Por isso existe
`seed/demo.mjs`:

- **nunca** grava por cima de dados reais: só insere quando `samples` está vazia;
- toda linha é marcada com `metadata.demo = true` e código `DEMO-...`;
- os vereditos gerados usam `rule_version = 'demo-basic-v1'` e
  `evaluated_by = 'demo-seed'`, para se distinguirem dos oficiais;
- `npm run demo:purge` remove apenas essas linhas.

Conteúdo: 3 pontos de coleta (2 de água superficial no Rio Itajaí-Açu, 1 de
água tratada), 12 amostras quinzenais (ago/2026 – out/2026), 132 resultados
(11 parâmetros × 12 amostras) e **188 vereditos ativos** distribuídos nas 4
legislações carregadas (172 limites) — cada lei só julga a matriz que ela
cobre (PRO-13):

| Legislação | Matriz que julga | Conformes | Não conformes | Indeterminados |
| --- | --- | --- | --- | --- |
| CONAMA-357-2005 | surface (8 amostras) | 80 | 7 | 1 |
| EPA-NPDWR | tap (4 amostras) | 38 | 6 | 0 |
| EU-2020-2184 | tap (4 amostras) | 21 | 3 | 12 |
| WHO-GDWQ | tap (4 amostras) | 8 | 4 | 8 |

Os exemplos de não conformidade continuam os calibrados para a CONAMA: pH 9,4
(fora de 6–9), turbidade 145 NTU, oxigênio dissolvido 3,9 mg/L, nitrato
13,8 mg/L, nitrito 1,4 mg/L, ferro 0,71 mg/L e manganês 0,17 mg/L. Um resultado
em estado `preliminary` (nitrato da DEMO-2026-005) gera veredito indeterminado
até o laudo final; arsenênio com `below_dl` na DEMO-2026-001 mostra o tratamento
de valor censurado.

### Corrigido (PRO-13): escopo de matriz não é mais NULL

Até 20/10 a seção abaixo registrava o diagnóstico: as 135 linhas de WHO/EU/EPA
gravavam `applies_to_matrix = NULL` e o predicado lia NULL como “vale para
qualquer matriz”, então água bruta de rio era julgada contra o limite de
1 NTU da água de consumo — os 12 de 12 consolidados saíam “Não conforme”.

A correção é do projeto de dados, migration `0005_matrix_scope.sql`
([PRO-13](/PRO/issues/PRO-13)):

- `legislation_limits.applies_to_matrix` passou a **NOT NULL**; as 135 linhas
  de WHO/EU/EPA receberam `tap` (escopo lido do texto de cada instrumento) e
  CONAMA permaneceu `surface`. Hoje: 37 `surface` + 135 `tap`, nenhum NULL.
- `'any'` entrou no domínio `water_matrix` como o caminho **deliberado** para
  “cobre todas as matrizes” — silêncio intencional, nunca coluna omitida.
- `limit_applies_to_matrix(matriz_amostra, escopo_limite)` virou a única
  definição do casamento matriz×limite, usada por `lib/data.mjs`,
  `seed/demo.mjs` e pela derivação de vereditos. O predicado antigo
  `(ll.applies_to_matrix IS NULL OR ll.applies_to_matrix = s.matrix)` saiu do
  código.
- Os **200 vereditos vivos** que julgavam uma matriz não coberta foram
  **superados** (`superseded_at`, nunca sobrescritos — trilha de auditoria
  preservada) e o demo seed regerou os vereditos: **188 ativos**
  (147 conformes / 20 não conformes / 21 indeterminados), 0 veredito vivo de
  superfície contra WHO/EU/EPA.

Efeito no consolidado: cada amostra lê o estado certo **por lei**. Água
superficial mostra **Sem limite aplicável** para EPA/UE/OMS (e é julgada só
pela CONAMA); água tratada mostra **Sem limite aplicável** para a CONAMA (e é
julgada por EPA/UE/OMS). Os selos por legislação em `/amostras` e o estado
por lei em `/amostras/:code` agora listam as quatro leis: linha com veredito
mostra o roll-up, linha sem veredito mostra `no_limit` (neutro) ou
`not_evaluated` conforme a cobertura — os cinco estados de
[PRO-5](/PRO/issues/PRO-5) não colapsam uns nos outros.

O diagnóstico original está no comentário de 19/10 do FrontendEngineer em
[PRO-4](/PRO/issues/PRO-4#comment-bb3fcbad-262d-4f34-b3bd-91c48c5914a5); o
relatório com contagens antes/depois está em
[PRO-13](/PRO/issues/PRO-13).

Dois ajustes conscientes no seed, para o consolidado não virar tudo âmbar:

1. **Coliformes termotolerantes ficaram de fora dos resultados.** O limite da
   CONAMA para esse parâmetro está com `conversion_status = 'ambiguous'` e
   valor canônico nulo (NMP/100 mL publicado × CFU/100 mL canônico). Pela
   diretriz aprovada, todo veredito dessa linha seria *indeterminado* — o que
   deixaria **nenhuma** amostra conforme. O limite continua visível em
   `/limites` e `/comparativo` com a conversão marcada como pendente; quando o
   valor canônico for confirmado, basta voltar a medir esse parâmetro.
2. **Uma unidade de detecção censurada** (arsenênio na DEMO-2026-001,
   `below_dl`) para mostrar o tratamento de valores censurados: conformidade
   só é afirmada quando o próprio LD já cabe dentro do limite.

> Substitua por ensaios reais assim que existirem: `npm run demo:purge` e depois
> cadastre os registros (interface de CRUD do projeto ou inserts diretos).

## Estrutura do código

```
web/
  server.mjs          entrada (node:http) e ciclo de vida
  routes.mjs          tabela de rotas com :param e composição das queries
  check.mjs           sonda de saúde
  lib/
    config.mjs        leitura do .env + DATABASE_URL
    db.mjs            pool pg (query/ping/close)
    data.mjs          todas as queries do dashboard
    report.mjs        modelo do relatório por amostra (PRO-19): estados,
                      roll-up, regras compostas e citações
    format.mjs        datas (America/Sao_Paulo), números pt-BR, rótulos
    chart.mjs         gráfico SVG de série temporal (sem dependências)
    html.mjs          layout, navegação em pt-BR, escape, tabelas, selos
    entities.mjs      configuração das 6 entidades do editor /admin
    crud.mjs          SQL de listagem/gravação, unicidade, erros PG traduzidos
    forms.mjs         campos e erros dos formulários
  routes/
    admin.mjs         rotas do editor CRUD (/admin)
  pages/
    admin_list.mjs    painel e listagem do editor
    admin_form.mjs    formulário, detalhe e confirmação de exclusão
  pages/              um módulo por tela (overview, samples, sample_detail,
                      report, timeline, comparative, limits)
  public/styles.css   estilos
  seed/demo.mjs       dados de demonstração (seed/purge)
```

Stack: Node ≥ 20, `node:http` + `pg`, HTML renderizado no servidor a partir de
template literals. **Sem bundler, sem etapa de build** — edite, salve, atualize
o navegador.

## Limitações conhecidas

- As quatro leis estão carregadas (CONAMA, WHO, UE, EPA — 172 limites) e as
  telas já se comportam com múltiplas leis, cada uma julgando só a matriz que
  cobre (PRO-13).
- Ainda não há ensaios reais no banco: o que se vê hoje é o seed de
  demonstração.
- Vereditos calculados pelo `seed/demo.mjs` são didáticos; as regras oficiais
  (médias, janelas, frequência) ficam com o projeto de dados.
