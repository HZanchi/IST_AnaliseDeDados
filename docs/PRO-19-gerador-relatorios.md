# PRO-19 — Gerador de relatório por amostra

Implementação do contrato [PRO-5](/PRO/issues/PRO-5) (spec v6): o relatório
de ensaio deixou de ser só especificação e passou a ser uma página renderizada
a partir do banco `waterquality`.

- **Issue:** [PRO-19](/PRO/issues/PRO-19) (aceita pelo CEO em 23/10/2026)
- **Contrato:** [PRO-5-report-output-spec.md](./PRO-5-report-output-spec.md)
- **Onde roda:** dashboard em `web/`, `GET /amostras/:code/relatorio`
- **Dependências novas:** nenhuma — `node:http` + `pg`, HTML no servidor

## Como usar

```bash
cd projetoAplicado/web
npm start                 # http://127.0.0.1:3000
```

| URL | Resultado |
| --- | --- |
| `/amostras/DEMO-2026-010/relatorio` | Relatório com a lei padrão (CONAMA 357/2005) |
| `/amostras/DEMO-2026-010/relatorio?lei=WHO-GDWQ` | Mesma amostra, conclusão pela OMS; demais leis continuam visíveis como referência |
| `/amostras/DEMO-2026-010/relatorio?lei=nenhuma` | Sem lei vinculante: nenhuma conclusão geral, só os resultados por lei |

O link “Relatório” no detalhe da amostra (`/amostras/:code`) leva à mesma rota.

### Parâmetro `lei`

- Ausente → `CONAMA-357-2005` (padrão do IST).
- Código de lei carregada → aquela lei vira a **lei vinculante** da conclusão.
- `nenhuma` (também `nenhum`, `none`, `sem`, `off`, `todas`, `all`) → nenhuma
  conclusão geral; o relatório mostra apenas os estados por lei.
- Código inexistente → **400** com a lista das leis válidas.
- Amostra inexistente → **404**.

A lei vinculante é **parâmetro de renderização**, não coluna do esquema. A
conclusão é calculada só contra ela; as outras leis permanecem visíveis e
nunca são escondidas nem misturadas na média.

## O que o relatório entrega

Blocos na ordem do template §3.3:

1. **Cabeçalho** — identificação da amostra, ponto, matriz, datas e emissão
   (`REL-<código>-<timestamp>`).
2. **Resumo** — tabela por lei + conclusão geral e a nota de cobertura
   obrigatória `N de M resultados com limite aplicável (<lei>)`.
3. **Resultados** — uma linha por resultado × limite aplicável, com valor
   publicado e normalizado, veredito e citação; linhas `Regra composta` para
   regras multi-entrada (PRO-17).
4. **Comparativo** — legislações lado a lado, células multi-linha, marcadores
   principal/referência. **Sem coluna “mais restritiva”** — quando um par
   (lei, parâmetro) tem dois limites vivos, os dois aparecem.
5. **Legenda** — os cinco estados do PRO-5 + `pendente`, sempre presente.
6. **Citações e responsável técnico** — duas camadas por limite (dispositivo +
   texto), com fallback para `test_parameters.method_reference` quando
   `results.method_code` é nulo.

Amostras de demonstração recebem aviso e marca d'água **DADOS DE
DEMONSTRAÇÃO**; o relatório não se apresenta como laudo oficial.

## Arquitetura e decisões

- **Modelo e renderização separados.**
  - `web/lib/report.mjs` — consultas e derivação de estado (modelo).
  - `web/pages/report.mjs` — HTML dos blocos, sem regra de negócio.
- **O renderer não recalcula veredito (§2.8).** Lê
  `compliance_verdicts` com `superseded_at IS NULL`. A única derivação de
  estado é a de regra composta, porque o agregado não é gravado no banco.
- **Escada única de severidade (§5):** `Não conforme > Indeterminado >
  Não avaliado > Sem limite aplicável > Conforme`, aplicada por resultado e
  no roll-up da amostra. Regra composta não cria sexto estado.
- **Limite aplicável = parâmetro + `limit_applies_to_matrix()` + vigência.**
  A janela usa `coalesce(limite, lei)`; sem data de vigência registrada, o
  limite vale (PRO-18 segue em `backlog`, gated).
- **Sem “não modelado”.** Regra composta com entrada ausente ou não final
  vira **Indeterminado**, nomeando a entrada que falta — nunca “Sem limite
  aplicável”.
- **Guarda do §3/§6:** linha julgada sem citação nomeada (`citation` no
  limite/regra + `document_reference` na lei) não é emitida; a rota devolve
  **422** com a lista das linhas faltantes, em vez de um relatório sem fonte.
- **Sem persistência.** O relatório é gerado sob demanda; o §7 item 6
  (gravar emissões) não foi implementado. Nenhuma mudança de schema ou seed.

## Arquivos-chave

| Arquivo | Papel |
| --- | --- |
| `web/lib/report.mjs` | Modelo do relatório: consultas, estados, roll-up, regras compostas, citações, `ReportError` |
| `web/pages/report.mjs` | Renderização dos blocos §3.3, troca de lei, marca d'água, botão imprimir/PDF |
| `web/routes.mjs` | Rota `GET /amostras/:code/relatorio` (leitura de `?lei=`, 400/422/404) |
| `web/pages/sample_detail.mjs` | Link “Relatório” no detalhe da amostra |
| `web/public/styles.css` | Estilos de impressão e do relatório |
| `docs/dashboard.md` | Visão geral do dashboard, já com a rota |

## Como verificar

Com o dashboard no ar e o seed de demonstração carregado:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3000/amostras/DEMO-2026-010/relatorio?lei=CONAMA-357-2005'
```

Conferir na página:

- `DEMO-2026-010`: Geral **Não conforme (CONAMA 357/2005)**, cobertura
  `11 de 11`, 9 conformes / 2 não conformes; WHO/EU/EPA como **Sem limite
  aplicável (`tap`)**.
- `DEMO-2026-003` (água tratada): CONAMA sem limite aplicável; nitrato da UE
  com célula multi-linha e estado **Indeterminado**; compostos WHO
  nitrato+nitrito e EU PCE+TCE avaliados, com entradas faltantes nomeadas.
- `?lei=nenhuma` não mostra conclusão geral; código de lei inválido devolve
  400; amostra inexistente devolve 404.
- Nenhum rótulo de enum cru (`maximum`, `single_sample`, `not_evaluated`…)
  aparece na página.

As 12 amostras de demonstração foram validadas pelo FrontendEngineer e
reconferidas pelo CEO em [PRO-19](/PRO/issues/PRO-19).

## Follow-ups

- **Ensaio real (papel/PDF, mesmo tarjado):** toda verificação atual usa dados
  sintéticos `DEMO-*`. O board ainda não enviou uma amostra real para rodar o
  pipeline lado a lado.
- **Persistência de emissões (§7 item 6):** hoje cada acesso gera de novo; não
  há histórico de relatórios emitidos.
- **PRO-18 (vigência):** segue em `backlog`, corretamente gated; quando
  amostras históricas entrarem, a janela de vigência precisa de dados reais.
- **Regras compostas:** avaliadas em código; qualquer novo tipo de regra exige
  atualização de `lib/report.mjs` e do spec.
