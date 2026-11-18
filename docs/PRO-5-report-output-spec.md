# PRO-5 — Report & documentation output spec

Specification for how a water-quality analysis is documented: per-sample
report, cross-legislation comparison, verdict rules, wording and citations.

- Source issue: [PRO-5](/PRO/issues/PRO-5)
- Product decisions: [plan document](/PRO/issues/PRO-5#document-plan) (CEO)
- Grounded in the approved schema [PRO-3](/PRO/issues/PRO-3), the seeded limits
  [PRO-4](/PRO/issues/PRO-4), the shipped UI [PRO-8](/PRO/issues/PRO-8) /
  [PRO-9](/PRO/issues/PRO-9), and the composite-limit tables added by
  [PRO-17](/PRO/issues/PRO-17).
- Data project: `waterquality-db` (Paperclip Onboarding workspace, `_default`).
  App: [`../web/`](../web/). Database: PostgreSQL `waterquality`.
- Status: **v6 (final)** — CEO product decisions (2026-10-21), the PRO-14
  sign-off (2026-10-21), the PRO-17 composite-limit model (2026-10-21) and the
  effective-dates decision ([PRO-18](/PRO/issues/PRO-18)) are incorporated. All
  7 PRO-14 checklist items are expressible; 3 needed notes, applied here.

This doc does **not** add product features. It records the rules the
implementers built against, resolves the layout details the plan left open, and
flags the points that need a source or product decision.

---

## 1. Vocabulary — five display states + one qualifier

`compliance_verdicts.verdict` only ever holds three values (enforced by CHECK).
The other display states are **derived**, never stored.

| # | State | pt-BR string | Source | Meaning |
| - | ----- | ------------ | ------ | ------- |
| 1 | `compliant` | **Conforme** | `compliance_verdicts.verdict` | measured within the applicable limit |
| 2 | `non_compliant` | **Não conforme** | `compliance_verdicts.verdict` | measured outside the applicable limit |
| 3 | `indeterminate` | **Indeterminado** | `compliance_verdicts.verdict` | cannot be judged (censoring, ambiguous conversion, preliminary result, text limit) |
| 4 | `no_limit` | **Sem limite aplicável** | derived: no active `legislation_limits` row for parameter where `limit_applies_to_matrix(samples.matrix, ll.applies_to_matrix)` is true and the sample date is in the effective window | the law does not cover this case |
| 5 | `not_evaluated` | **Não avaliado** | derived: limit row exists, no live verdict | not yet computed / verdict retired on edit |

**Qualifier, not a state:** `legislation_limits.conversion_status = 'ambiguous'`
prints **`pendente`** next to the limit. It is not a verdict. The verdict
computed against such a limit is `indeterminate` (e.g. EU/WHO nitrate on the
tap-water samples `DEMO-2026-003/006/009/012`; those limits are scoped `tap`,
so a surface sample is not judged against them at all — see §2.1).

Rules:

- **Never collapse 4 into 1 or 5 into 3.** "Sem limite aplicável" is not
  compliance; "Não avaliado" is not "Indeterminado". A dash where the
  distinction belongs is a defect, not a shorthand.
- The canonical pt-BR strings are the ones already shipped in
  `web/lib/format.mjs` (`VERDICT_LABEL`). Do not introduce synonyms
  (*aprovado*, *reprovado*, *pendente de análise*).
- **Roll-up precedence:** `Não conforme > Indeterminado > Não avaliado >
  Sem limite aplicável > Conforme`. Details and the coverage caveat in §5.
- **Composite rules** (§2.9) use the same five strings. A missing input makes the
  rule **Indeterminado**; it never turns into `Sem limite aplicável` or into a
  silent `Conforme`.
- **`pendente` is about the limit, not the result.** Keep the published value
  visible and leave the canonical column blank; never invent a conversion.

---

## 2. Compliance verdict rules (auto-evaluation)

This is the ruleset for producing a `compliance_verdicts` row from one
`results` row and one `legislation_limits` row. Reports **read** the live
verdicts; they do not recompute them (§2.8). When no live verdict exists the
report prints **Não avaliado**, not a guess.

### 2.1 Preconditions

A limit is **applicable** to a result when all of these hold:

1. `legislation_limits.parameter_id = results.parameter_id`.
2. The matrix predicate returns true:
   `limit_applies_to_matrix(samples.matrix, ll.applies_to_matrix)`.
   `applies_to_matrix` is **NOT NULL** since [PRO-13](/PRO/issues/PRO-13) /
   `migrations/0005_matrix_scope.sql`: CONAMA is `surface` (37 rows), WHO/EU/EPA
   are `tap` (135 rows), and `'any'` is the deliberate "covers every matrix"
   value. `'any'` matches everything, a physical value matches only itself, and
   `NULL` matches nothing (defensive; there are no NULL rows today).
3. The sample date falls in the effective window:
   `coalesce(ll.effective_from, l.effective_from)` ≤ sample date ≤
   `coalesce(ll.effective_to, l.effective_to)`; `NULL` means unbounded.
   *All 172 limit dates and all 4 law dates are `NULL` today and stay `NULL`
   (CEO decision, 2026-10-21 — [PRO-18](/PRO/issues/PRO-18)), so no result is
   filtered by date; see §6 for the required display fallback.*
4. The limit is the current row (the unique identity index already guarantees
   one row per law × parameter × matrix × `limit_tier`).

The result is **eligible** for auto-evaluation when:

- `results.data_status = 'final'` (preliminary/amended/rejected → `indeterminate`);
- the result unit equals the canonical limit unit (`legislation_limits.unit`),
  otherwise → `indeterminate` with a unit-mismatch reason;
- the limit has a canonical value, or is a text limit. A non-text limit with
  `conversion_status = 'ambiguous'` and canonical `NULL` → `indeterminate`
  (displayed with **`pendente`**).

**Two of these rules are seed contracts, not database constraints** (PRO-14,
item 7). `legislation_limits` only enforces `unit IS NOT NULL`; nothing compares
`results.unit` to `limit.unit`. And migration `0004` only *permits* a NULL
canonical value for ambiguous rows, it does not *require* it. Both hold today
(0 unit divergences, 0 `ambiguous` rows with a canonical value), but only
because the seeds enforce them. The evaluation engine must compare
`results.unit` against `limit.unit` at runtime and treat a missing canonical on
an `ambiguous` limit as `indeterminate`; do not rely on the schema. Tightening
these into CHECKs would need a future migration and is out of scope here.

### 2.2 Value comparison

Equality is **within** the limit (max: value ≤ limit; min: value ≥ limit;
range: lower ≤ value ≤ upper). Store both the verdict and a human-readable
`reason`; reports surface the reason for indeterminate rows.

| `limit_kind` | Condition for `compliant` | Condition for `non_compliant` | Otherwise |
| ------------ | ------------------------- | ----------------------------- | --------- |
| `max` | `value ≤ limit_value` | `value > limit_value` | `indeterminate` (missing value/unit mismatch) |
| `min` | `value ≥ limit_value` | `value < limit_value` | `indeterminate` |
| `range` | `limit_lower ≤ value ≤ limit_upper` | outside the range | `indeterminate` |
| `text` | — (manual review) | — (manual review) | `indeterminate` with the published `limit_text` |

Text limits (`limit_kind='text'`, `conversion_status='not_applicable'`) have no
automatic pass/fail. A human-entered verdict may still be stored; the report
prints it with the `limit_text` verbatim and `evaluated_by` provenance.

### 2.3 Censored results

`results.censored` must never be treated as zero.

| Censoring | `max` limit | `min` / `range` limit |
| --------- | ----------- | --------------------- |
| `below_dl`, `not_detected` | `compliant` if `detection_limit ≤ limit`; else `indeterminate` | `indeterminate` |
| `above_ul` | `non_compliant` if the bound is already above a max limit; else `indeterminate` | `indeterminate` (unless bound proves out) |
| `trace` | `indeterminate` unless the trace bound is inside the limit | `indeterminate` |

The reason string must name the detection limit and the legal limit, e.g.
`resultado abaixo do limite de detecção (0,5), que já está dentro do limite 10`.
This matches the shipped demo evaluator and the live `DEMO-2026-001` arsenic row.

**Detection limit source:** `results.detection_limit` exists but is unset on
all 132 results today; the catalog carries `test_parameters.detection_limit`
on 90 of 93 parameters. The rule must use
`coalesce(results.detection_limit, test_parameters.detection_limit)`, never a
hard-coded zero.

### 2.4 Non-single-sample basis

`legislation_limits.basis` decides whether a per-sample verdict is meaningful:

| `basis` | Per-sample report treatment |
| ------- | --------------------------- |
| `single_sample` | normal auto-evaluation (§2.2) |
| `running_average`, `periodic_average`, `frequency` | **Não avaliado** with the basis and `assessment_window` visible. Do not print Conforme/Não conforme from one sample. |

The database currently has no aggregate evaluation engine for the other bases.
Live data has no verdicts against `basis <> 'single_sample'` (verified in
`seeds/README.md` and by query); keep it that way until the window engine exists.
This is why CONAMA thermotolerant coliforms (frequency, ambiguous) and EPA
lead/copper action levels (periodic average) must not be presented as a
single-sample pass/fail.

### 2.5 Limit tiers are qualifiers, not synonyms for compliance

Every verdict/limit line prints its `limit_tier` and `basis` in pt-BR:

| `limit_tier` | pt-BR label | Reading |
| ------------ | ----------- | ------- |
| `maximum` | Limite máximo | legal/environmental maximum |
| `action_level` | Nível de ação | action/response threshold |
| `treatment_technique` | Técnica de tratamento | treatment performance requirement |
| `aesthetic` | Estético | aesthetic/secondary standard |
| `guideline` | Diretriz | health-based reference value |

A `guideline` or `aesthetic` verdict still uses the same five strings, but the
tier label makes clear it is not a statutory maximum. Never drop the tier to
make a table shorter.

### 2.6 Replicates

`results` is unique per `(sample_id, parameter_id, replicate)`. The report shows
one line per replicate and never averages them. A result-level state is the
worst across its replicates, using the §1 precedence. If the lab reports a
single combined value, that is one row with `replicate = 1`.

### 2.7 Provenance and demo data

- `rule_version` and `evaluated_by` are mandatory in the report footer.
  Demo rows use `rule_version='demo-basic-v1'`, `evaluated_by='demo-seed'`.
- Any report containing demo rows or demo verdicts carries the watermark
  **DADOS DE DEMONSTRAÇÃO** and is not an official compliance report.
- Reports must declare the source database and the extraction timestamp.

### 2.8 Renderer vs. engine

The report renderer never computes a verdict. It reads
`compliance_verdicts` where `superseded_at IS NULL` and renders the stored
verdict, `reason`, `rule_version` and `evaluated_by`. This keeps the audit trail
and prevents the UI and the report from disagreeing.

If the renderer finds no live verdict for an applicable limit, it prints
**Não avaliado**. It does **not** fall back to "looks compliant" or to a
recomputed comparison.

### 2.9 Composite limits (multi-input rules, PRO-17)

Two real limits cannot be expressed as one `legislation_limits` row (1 law ×
1 parameter):

- **WHO** — `(NO₃/50) + (NO₂/3) ≤ 1` (combined nitrate + nitrite).
- **EU** — `[PCE] + [TCE] ≤ 10 µg/L` (tetrachloroethene + trichloroethene).

Before [PRO-17](/PRO/issues/PRO-17) a report joining limit × parameter found no
row and derived **Sem limite aplicável** — false: the law covers the case, the
model did not. `migrations/0006_composite_limits.sql` fixes the model; the
report must evaluate the expression, not print `Sem limite aplicável`.

**Tables**

| Table | Holds | Identity |
| ----- | ----- | -------- |
| `composite_limits` | the rule, same shape as `legislation_limits` (limit kind/value/unit, `applies_to_matrix`, tier, basis, citation, effective window, `published_*` + `conversion_*`) | `(legislation_id, rule_code)` |
| `composite_limit_inputs` | the terms: parameter, ordinal, coefficient, published and canonical reference (ratio rules) | `(composite_limit_id, parameter_id)`, unique `ordinal` |

A deferred constraint trigger enforces **≥2 inputs per rule** and a
`reference_value` on every `ratio_sum` input.

**Evaluation**

```
sum        → Σ (coefficient × result.value)                 ≤ limit_value
ratio_sum  → Σ (coefficient × result.value / reference_value) ≤ limit_value
```

- Only `data_status = 'final'` results of the **same sample**, in the parameter's
  canonical unit (`test_parameters.unit`).
- Matrix match reuses `limit_applies_to_matrix(samples.matrix, cl.applies_to_matrix)`.
- Any input missing or non-final → **Indeterminado** (`indeterminate`), with a
  reason naming the missing input. **Never `Sem limite aplicável`.**
- All inputs present and within the expression → **Conforme**; outside →
  **Não conforme**.

**Seeded rules**

| Rule | `rule_kind` | Expression | Canonical reference |
| ---- | ----------- | ---------- | ------------------- |
| OMS `who_nitrate_nitrite_ratio` | `ratio_sum` | (NO₃/50) + (NO₂/3) ≤ 1 | 50 × 14/62 = **11,29032 mg/L as N**; 3 × 14/46 = **0,91304 mg/L as N** |
| UE `eu_pce_tce_sum` | `sum` | [PCE] + [TCE] ≤ 10 µg/L | direct sum, no divisor |

The WHO divisors are converted **only in `reference_value`**
(`conversion_status='converted'` + note); the published forms (50 mg/L as NO₃⁻,
3 mg/L as NO₂⁻) stay in `reference_published_*` for citation. A ratio with mixed
bases would change the verdict, so this is deliberate. The **individual** rows
for nitrate/nitrite/PCE/TCE stay `ambiguous`/canonical NULL — the CEO rule
(signal, do not presume) is unchanged. Never compute a composite rule from the
individual verdicts; evaluate the expression from the results.

**Report output**

- One **`Regra composta`** row per `(sample, composite_rule)`, alongside the
  regular result rows: expression, inputs used, published form, tier/basis,
  state. Example (`DEMO-2026-003`, tap): `OMS (NO₃/50)+(NO₂/3) ≤ 1 · 0,5831 ·
  Diretriz/amostra individual → Conforme (OMS GDWQ)`.
- A missing input prints **Indeterminado** with the missing parameter named —
  e.g. EU PCE/TCE are not measured in the demo, so the EU sum is
  **Indeterminado**, not `Sem limite aplicável`.
- Aggregated verdicts are **not stored** in `compliance_verdicts` (that table is
  1 result × 1 limit). The report renderer derives them and cites
  `composite_limits.citation` / `notes`.
- Composite rows participate in the §5 sample severity ladder like any other
  verdict. They do **not** change the `N de M resultados com limite aplicável`
  denominator (which counts results); list them separately.

Live smoke (2026-10-21): WHO ratio on the four tap samples =
**0,5831 / 0,7134 / 0,8041 / 0,8635**, all **Conforme**; EU sum has 0 measured
inputs → **Indeterminado** (verified in PRO-17).

---

## 3. Per-sample report — template

One report per sample, blocks in this order.

| Block | Content | Fields |
| ----- | ------- | ------ |
| 1. Header | sample, point, matrix, date/time, responsible, **binding law** | `samples.code`, `sampling_points.name/region`, `samples.matrix`, `samples.collected_at`, `samples.collected_by`, render-time `target_legislation_id` |
| 2. Verdict summary | **overall against the binding law** + one row per legislation | render-time target (§5.2) + `v_sample_compliance_summary` |
| 3. Result table | one row per result × limit judged, plus one `Regra composta` row per applicable composite rule (§2.9) | `v_compliance_verdicts`, `test_parameters`, `legislation_limits`, `composite_limits` / `composite_limit_inputs` |
| 4. Comparison table | parameter × legislation | §4 |
| 5. Legend | mandatory, all five states + `pendente` | §1 |
| 6. Citations | one entry per cited limit, verbatim | §6 |
| 7. Signature | technical responsible / issuance | not in schema; placeholder |

Formatting:

- Dates/times in **`America/Sao_Paulo`**, `DD/MM/YYYY HH:MM`.
- Numbers in pt-BR (`1.234,5`); units verbatim from the database.
- The overall conclusion always names its law: `Conforme (CONAMA 357/2005)`.
  An unlabeled overall conclusion is invalid.
- Report ID: `REL-<sample.code>-<YYYYMMDD-HHmm>` (generated; not persisted —
  see §7).
- **A report that cannot name the limit it applied does not get issued.** If a
  judged row has no citation in block 6, the report is invalid. No silent pass.

### 3.1 Result table granularity

Rows are **one per `(result, live verdict)`**, i.e. one per applicable
`legislation_limit` that was judged. Group by parameter; order by law, then
`limit_tier`, then `basis`. This deviates from the plan's shorthand "one row per
parameter" only because one law can legitimately carry more than one limit for
the same parameter (confirmed: EPA fluoride `aesthetic` 2,0 + `maximum` 4,0;
EPA copper `action_level` + `aesthetic`; EU lead `action_level` + `maximum`).

- If a result has **no applicable limit at all**, emit one row with law `—`,
  limit `—`, state **Sem limite aplicável**.
- If a limit exists but has **no live verdict**, emit its row with state
  **Não avaliado**.
- **Composite rules** (§2.9) emit separate `Regra composta` rows after the
  per-result rows: one per applicable `(sample, rule_code)`, regardless of
  whether each input parameter has its own row.
- Do not enumerate laws that have no limit for the parameter; that is the
  comparison table's job (§4).

### 3.2 Filled example — `DEMO-2026-010` (real live data)

Surface water, Rio Itajaí-Açu — Ponte Velha.

**Header**

| Field | Value |
| ----- | ----- |
| Amostra | `DEMO-2026-010` |
| Ponto | Rio Itajaí-Açu — Ponte Velha (`PT-RIO-01`), Vale do Itajaí — Blumenau |
| Matriz | Água superficial (`surface`) |
| Coletada em | 07/10/2026 09:05 (`America/Sao_Paulo`) |
| Responsável | Equipe de demonstração |
| Situação | DADOS DE DEMONSTRAÇÃO · `rule_version = demo-basic-v1` |

**Verdict summary**

Lei de referência (conclusão): **CONAMA 357/2005**.

Overall: **Não conforme (CONAMA 357/2005)** — 9 Conforme, 2 Não conforme,
0 Indeterminado. Cobertura: **11 de 11 resultados com limite aplicável
(CONAMA 357/2005)**.

Since [PRO-13](/PRO/issues/PRO-13) the matrix scope is explicit: this surface
sample is judged **only by CONAMA** (11 live verdicts). `v_sample_compliance_summary`
returns exactly **one** row for it. WHO/EU/EPA limits are `tap`-scoped, so the
per-law summary must print **Sem limite aplicável** for those three — not a
0/0/0 verdict row, and not a manufactured `Não conforme`:

| Legislação | Conformes | Não conformes | Indeterminados | Veredito |
| ---------- | --------: | ------------: | -------------: | -------- |
| CONAMA 357/2005 | 9 | 2 | 0 | **Não conforme** |
| EPA NPDWR | — | — | — | **Sem limite aplicável** (limite `tap`) |
| UE 2020/2184 | — | — | — | **Sem limite aplicável** (limite `tap`) |
| OMS GDWQ | — | — | — | **Sem limite aplicável** (limite `tap`) |

**Result table — excerpt** (full table has 11 judged rows for this sample, all
CONAMA)

| Parâmetro | Resultado | Lei | Limite publicado | Limite normalizado | Nível / base | Veredito |
| --------- | --------- | --- | ---------------- | ------------------ | ------------ | -------- |
| pH | 7,2 pH units | CONAMA 357/2005 | 6–9 pH units | 6–9 pH units | Máximo / amostra individual | **Conforme** |
| turbidez | 145 NTU | CONAMA 357/2005 | 100 UNT | 100 NTU | Máximo / amostra individual | **Não conforme** |
| nitrato (como N) | 13,8 mg/L as N | CONAMA 357/2005 | 10 mg/L N | 10 mg/L as N | Máximo / amostra individual | **Não conforme** |
| oxigênio dissolvido | 6,4 mg/L | CONAMA 357/2005 | ≥ 5 mg/L O2 | ≥ 5 mg/L | Máximo / amostra individual | **Conforme** |

The other seven rows (arsenic, chloride, fluoride, iron, manganese, nitrite,
total dissolved solids) are all **Conforme** against CONAMA.

**State coverage (real rows outside this sample)**

- **Sem limite aplicável**: `DEMO-2026-003` (água tratada), oxigênio dissolvido
  6,4 mg/L — CONAMA 357/2005 is `surface`-only and EPA/EU/WHO have no DO limit,
  so the result has **zero** applicable limits. It must print
  **Sem limite aplicável**, never "Conforme". The symmetric case is any surface
  sample against WHO/EU/EPA (`tap`-only).
- **Não avaliado**: not present in the demo fixture (every applicable limit has
  a live verdict). Exact row format:
  `chumbo | 0,008 mg/L | EPA NPDWR | 0,015 mg/L (normalizado: 15 µg/L) | Nível de ação / média periódica | **Não avaliado**`.
  This state requires a limit without a live verdict (or a non-single-sample
  basis); it is not a verdict. PRO-14 validated two scratch-DB fixtures for it:
  **A** retire one CONAMA verdict of `DEMO-2026-001` (`superseded_at = now()`)
  → the sample rolls up to **Não avaliado** with 1 unjudged result and coverage
  11/11; **B** insert one lead result into `DEMO-2026-003` → 4 applicable limits
  with no live verdict (WHO `guideline`; EU `action_level|periodic_average` +
  `maximum`; EPA `action_level|periodic_average`), covering both the retired
  verdict and the `basis <> single_sample` path. Both were run on a `pg_dump`
  copy and reverted; never apply them to the live DB.
- **pendente**: real rows on the tap samples, EU/WHO nitrate and nitrite
  (`conversion_status='ambiguous'`, canonical `NULL`; published 50 mg/L as
  NO3−).
- **Composite rules** (§2.9): WHO `(NO₃/50)+(NO₂/3)` = **Conforme** on the four
  tap samples (0,5831–0,8635); EU `[PCE]+[TCE]` has no measured inputs →
  **Indeterminado**, never `Sem limite aplicável`.

### 3.3 Empty template

```
RELATÓRIO DE ENSAIO — AMOSTRA <código>                    REL-<código>-<AAAAMMDD-HHmm>
Ponto: <nome> (<código>) — <região>
Matriz: <matriz>        Coletada em: <DD/MM/AAAA HH:MM> (America/Sao_Paulo)
Responsável: <collected_by>       Situação: <oficial | preliminar | DADOS DE DEMONSTRAÇÃO>
Regra: <rule_version>             Fonte: waterquality @ <timestamp>

1. RESUMO DE VEREDITO
   Lei de referência: <CONAMA 357/2005 | — (sem conclusão geral)>
   Geral: <Conforme | Não conforme | Indeterminado | Não avaliado | Sem limite aplicável> (<lei de referência>)
   Cobertura: <N de M resultados com limite aplicável (<lei de referência>)>
   <legislação>  conformes: N  não conformes: N  indeterminados: N  → <veredito>

2. RESULTADOS
   Parâmetro | Resultado | Lei | Limite publicado | Limite normalizado | Nível/base | Veredito
   <...>
   Regra composta: <regra_code> | <expressão> | <lei> | <publicado> | <Nível/base> | <Veredito>
   <...>

3. COMPARATIVO ENTRE LEGISLAÇÕES
   Parâmetro | CONAMA 357/2005 | OMS GDWQ | UE 2020/2184 | EPA NPDWR
   <...>
   Regra composta: <regra_code> | <expressão> | <CONAMA | OMS | UE | EPA> | <Veredito>
   <...>

4. LEGENDA
   Conforme · Não conforme · Indeterminado · Sem limite aplicável · Não avaliado · pendente
   <definições de §1, obrigatórias>

5. CITAÇÕES
   <linha composta + citação verbatim + document_reference + método>  (ver §6)

6. RESPONSÁVEL TÉCNICO
   Nome: ____________________  Registro: __________  Data: __/__/____
```

Legend is mandatory even when a state is unused. A report without block 4 is
invalid.

---

## 4. Cross-legislation comparison table

- **Rows** = result (sample × parameter × replicate); group replicates under
  their parameter so the reader compares the same measurement across laws.
- **Columns** = legislation (CONAMA, OMS, UE, EPA).
- **A cell is a list, not a scalar.** One law can have several limits for the
  same parameter (EPA fluoride, EPA copper, EU lead). Render one line per
  limit, each with its own tier, basis and verdict.
- Every line shows the **published** value/unit and the **normalized** value.
  Never the canonical value alone when a conversion happened.
- **Always visible qualifiers:** `limit_tier` and `basis`, using the pt-BR
  labels in §2.5 and: `single_sample` → *amostra individual*,
  `running_average` → *média móvel*, `periodic_average` → *média periódica*,
  `frequency` → *frequência*.
- Cell states: limit + verdict, **Sem limite aplicável**, **Não avaliado**, or
  **pendente** (published value shown, canonical blank). A cell may combine
  **pendente** with **Indeterminado**, e.g. `50 mg/l (as NO3−) · pendente →
  Indeterminado`.
- **No "strictest wins" column.** The tool never silently picks a law.
- **Composite rules do not fit a parameter cell** (they span two parameters).
  Render them as a separate `Regra composta` block after the table, one line per
  `(sample, rule_code)` with the expression and the §1 state. Never omit them,
  and never translate a missing input into `Sem limite aplicável` (§2.9).
- **Binding law is a render-time parameter, not a schema field.** The generator
  receives `target_legislation_id`; IST defaults to **CONAMA 357/2005**. When
  set, that column is marked **principal** and the others **referência**. When
  absent, all columns stay visually equal — but the report then has **no
  overall conclusion** (§5.2). Do not persist the choice: no migration until
  reports are stored (§7).
- **Superseding:** only live verdicts (`superseded_at IS NULL`) are shown. This
  is per `(result, limit)` re-evaluation, not a cross-law ranking. Do not use
  `superseded_at` to imply one law outranks another.

### 4.1 Column definitions

| Column | Source | Rule |
| ------ | ------ | ---- |
| Parâmetro | `test_parameters.name` / `code` | one row per parameter/result |
| Resultado | `results.value_numeric` + `results.unit` | censored values print `<`, `>`, `ND`; never `0` |
| CONAMA / OMS / UE / EPA | `legislations.short_name` | one column per law |
| Limite publicado | `published_value` / `published_lower` / `published_upper` + `published_unit` | verbatim as cited; never rewritten |
| Limite normalizado | `limit_value` / `limit_lower` / `limit_upper` + `unit` | blank + **pendente** when `conversion_status='ambiguous'` |
| Nível / base | `limit_tier`, `basis` | pt-BR labels, never raw enum codes |
| Veredito | `compliance_verdicts.verdict` or derived | §1 strings only |

Example row for `DEMO-2026-010` (surface) nitrate:

```
CONAMA: 10 mg/L N → 10 mg/L as N · Máximo/amostra individual → Não conforme
OMS:    Sem limite aplicável (limite `tap`)
UE:     Sem limite aplicável (limite `tap`)
EPA:    Sem limite aplicável (limite `tap`)
```

The same parameter on a tap-water sample (`DEMO-2026-003`) shows the
`pendente` path instead:

```
CONAMA: Sem limite aplicável (limite `surface`)
OMS:    50 mg/L (as NO3−) · pendente · Diretriz/amostra individual → Indeterminado
UE:     50 mg/l (as NO3−) · pendente · Máximo/amostra individual → Indeterminado
EPA:    10 mg/L as N · Máximo/amostra individual → Conforme
```

---

## 5. Roll-up

`v_sample_compliance_summary` is per **sample × legislation**, not one overall
verdict. The report therefore shows one summary row per law **and** an overall
row derived against the binding law (§5.2). The view alone is not enough for the
overall row or for distinguishing "no limit" from "not evaluated".

### 5.1 Per-result state

For each `(sample, result)`:

1. Applicable limits = §2.1 matrix/date/parameter join.
2. If zero applicable limits → **Sem limite aplicável**.
3. Else if any live verdict is `non_compliant` → **Não conforme**.
4. Else if any live verdict is `indeterminate` → **Indeterminado**.
5. Else if any applicable limit has no live verdict → **Não avaliado**.
6. Else → **Conforme**.

Only `basis='single_sample'` verdicts may drive steps 3–6. A limit with another
basis is shown as **Não avaliado** with its basis/window qualifier.

Composite rules are **sample-level**, not result-level: evaluate each applicable
rule per §2.9 and carry its state into the §5.2 ladder. Do not attach it to a
single result row or average it with the individual parameter verdicts.

### 5.2 Sample-level state

The overall conclusion is computed **only against the binding law** selected at
render time (`target_legislation_id`; IST default: **CONAMA 357/2005**). Other
laws remain fully visible in the per-law rows and comparison table, but never
feed the overall conclusion.

If no binding law is selected, the report **prints no overall conclusion** —
only the per-law results. A fallback to "all laws equal" is how a lab declares a
sample non-compliant against a foreign guideline it has no obligation to meet.
An undefendable conclusion is worse than none.

Within the selected law, apply the same precedence across all results:

```
Não conforme > Indeterminado > Não avaliado > Sem limite aplicável > Conforme
```

- If every result has zero applicable limits **under the binding law** → **Sem
  limite aplicável**, labeled with the law. If **any** result has an applicable
  limit, the sample is not `Sem limite aplicável`: the no-limit results are
  excluded from the severity ladder and the coverage note (`N de M resultados
  com limite aplicável`) records how many were excluded. Today the two cases do
  not collide (surface = 11/11 CONAMA; tap = 0/11 CONAMA), but the renderer must
  not treat one no-limit result as a sample-level `Sem limite aplicável`.
- If some results have limits and all of those are compliant, the sample is
  **Conforme**, labeled `Conforme (CONAMA 357/2005)`, with the **mandatory**
  coverage note: `N de M resultados com limite aplicável (CONAMA 357/2005)`.
  Without the coverage note, `Conforme` over a sample where most results have no
  limit is false assurance. Do not let a no-limit result masquerade as
  compliance.
- Replicates: worst across replicates; never average.
- This is the same ladder as §5.1 on purpose: one severity scale per-result and
  per-sample. A report with two scales is unexplainable to the lab.

This matches the plan's "worst-state-wins, never an average or a ratio that
hides a single failure" and extends it with the two presentation states. The
ladder and the label rule were confirmed by the CEO on 2026-10-21.

### 5.3 Per-law summary

Use `v_sample_compliance_summary` for the counts, but treat its
`sample_verdict = 'not_evaluated'` carefully:

- The view counts only judged results. A result with no applicable limit for
  that law is invisible, not "not evaluated".
- `not_evaluated` appears only when the sample has zero verdicts for that law.
- A mix of judged and unjudged results rolls up from the judged ones; use the
  §5.1 derivation to surface the unjudged ones as **Não avaliado** in the
  detail table.

Reference query:

```sql
select legislation_short_name, verdict_count, compliant_count,
       non_compliant_count, indeterminate_count, sample_verdict
from v_sample_compliance_summary
where sample_id = (select id from samples where code = 'DEMO-2026-010')
order by legislation_short_name;
```

---

## 6. Citation format

Two layers. Both are printed; neither replaces the other.

**Layer 1 — report identification line** (composed, stable order):

```
<short_name> (<jurisdiction>), parâmetro: <parameter name> (<code>), matriz: <matrix label>, <tier label>, <basis label>, publicado: <published form>, normalizado: <canonical form>, vigência: <effective window>.
```

**Layer 2 — source references** (verbatim, no paraphrase, no re-derivation):

```
<citation> · <document_reference> · método: <method_reference>
```

Rules:

- `<citation>` comes from `legislation_limits.citation` **verbatim**. It is the
  legal provision string and differs by law (CONAMA cites article/table, EPA
  cites the CFR part + MCL, WHO cites the annex table). Never rebuild it.
- `<document_reference>` comes from `legislations.document_reference`.
- Method: `test_parameters.method_reference` (catalog default), then
  `results.method_code` when the result overrides it. `results` has no
  `method_reference` column — do not pretend it does. **`results.method_code` is
  NULL on all 132 results today**, so every example uses the catalog value;
  the override path is defined but unexercised.
- **Every number in a report maps to a `legislation_limits` row.** A figure with
  no citable source does not appear.
- **Composite rules** (§2.9) cite `composite_limits.citation` verbatim (Layer 2)
  and, for `ratio_sum`, the input's `reference_published_value` /
  `reference_published_unit` (e.g. `50 mg/L (as NO3−)`), never the converted
  canonical divisor. The converted value is an evaluation detail, not a citable
  published number.
- **Effective dates are `NULL` on all 4 laws and all 172 limits, and stay that
  way for now (CEO decision, 2026-10-21).** The fallback is permanent until
  historical samples are ingested ([PRO-18](/PRO/issues/PRO-18), backlog with a
  written trigger). Do not print `in force –`. Print
  `vigência: publicada em <publication_date> (vigência não registrada)` when a
  publication date exists, otherwise `vigência: não registrada`.
  Rationale: today the dates change no report; a wrong `effective_from` would
  silently judge historical samples against the wrong law, and WHO guidelines
  have no legal force, so they must not get an effective date at all. Do not
  "improve" this by inventing dates.
- Report prose is pt-BR or English per the source issue; law names, `citation`,
  `document_reference` and `method_reference` stay verbatim. Localize only the
  connective labels (`in force` → `vigência`).
- Numbers in the composed line are pt-BR formatted (`0,01`), but the verbatim
  `citation` is untouched.

### 6.1 Worked examples (real seed rows)

**CONAMA — arsenic, converted**

```
CONAMA 357/2005 (Brazil), parâmetro: Arsenic (total) (arsenic), matriz: Água superficial, Limite máximo, amostra individual, publicado: 0,01 mg/L As, normalizado: 10 µg/L, vigência: publicada em 17/03/2005 (vigência não registrada).
Res. CONAMA nº 357/2005, art. 14, II, Tabela I (aplicável à classe 2 pelo art. 15) · Resolução CONAMA nº 357, de 17/03/2005 (DOU nº 053, de 18/03/2005, pgs. 58-63); tabelas I–III alteradas pontualmente pela Res. CONAMA nº 430/2011 (revoga o art. 38 e dispositivos de efluentes) · método: Hydride generation AAS / SM 3113 B
```

**EPA — lead action level, converted, periodic average**

```
EPA NPDWR (United States), parâmetro: Lead (lead), matriz: Água tratada/consumo (`tap`), Nível de ação, média periódica, publicado: 0,015 mg/L, normalizado: 15 µg/L, vigência: não registrada.
EPA — NPDWR: Lead action level (LCR 1991 / LCRR 2021; LCRI final 89 FR 86418, 30/10/2024) · 40 CFR Part 141 — NPDWR (MCL, níveis de ação, exigências de tratamento); 40 CFR Part 143 — NSDWR (padrões secundários, não obrigatórios); LCR 1991, LCRR 2021 e LCRI 2024 (89 FR 86418, chumbo-cobre). Data de publicação sem data única — usar data do instrumento específico em citações. · método: Graphite furnace AAS / SM 3113 B
```

**EU — nitrate, ambiguous (`pendente`)**

```
UE 2020/2184 (European Union), parâmetro: Nitrate (as N) (nitrate_as_n), matriz: Água tratada/consumo (`tap`), Limite máximo, amostra individual, publicado: 50 mg/l (as NO3−), normalizado: — (pendente), vigência: publicada em 16/12/2020 (vigência não registrada).
Diretiva (UE) 2020/2184, Anexo I, Parte B — Nitrate · Diretiva (UE) 2020/2184, de 16/12/2020 (JO L 435, 23.12.2020) — Anexo I, Partes A–D; substitui a Diretiva 98/83/EC · método: Ion chromatography / SM 4110 B
```

**WHO — nitrate, ambiguous (`pendente`, guideline)**

```
OMS GDWQ (Global), parâmetro: Nitrate (as N) (nitrate_as_n), matriz: Água tratada/consumo (`tap`), Diretriz, amostra individual, publicado: 50 mg/L (as NO3−), normalizado: — (pendente), vigência: não registrada.
WHO GDWQ 4ª ed. + adendos, Anexo 3, Tab. A3.3 — "Nitrate (as NO3−)" · WHO, Guidelines for drinking-water quality, 4th edition incorporating the first and second addenda (2022, ISBN 978-92-4-00450-64); valores conferidos contra o Anexo 3 (Tabs. A3.1/A3.3) e fichas químicas individuais. Observação: a OMS publicou um 3º adendo (2026) — reconfirmar valores individuais em revisão antes de auditoria formal. · método: Ion chromatography / SM 4110 B
```

**Text limit** (EU turbidity, `tap`): print `limit_text` verbatim in place of the
value; verdict is **Indeterminado** ("limite textual — exige conferência
manual"). `conversion_status='not_applicable'`, so no `pendente` label.

### 6.2 Reference renderer (SQL, tested on the live DB)

The composed Layer 1 line can be produced without application code. This query
is the executable reference; it returns the four composed lines above. Layer 2
(`citation` · `document_reference` · method) is printed verbatim from the rows.

```sql
with x as (
  select l.code, l.short_name, l.jurisdiction, l.document_reference,
         l.publication_date, tp.code as param_code, tp.name as param_name,
         ll.*,
         case ll.limit_kind
           when 'text' then 'texto: "' || ll.limit_text || '"'
           when 'range' then ll.published_lower || '–' || ll.published_upper
                            || ' ' || ll.published_unit
           else ll.published_value || ' ' || ll.published_unit
         end as published_form,
         case
           when ll.conversion_status = 'ambiguous' then '— (pendente)'
           when ll.limit_kind = 'text' then '—'
           when ll.limit_kind = 'range' then ll.limit_lower || '–'
                || ll.limit_upper || ' ' || ll.unit
           else ll.limit_value || ' ' || ll.unit
         end as canonical_form
    from legislation_limits ll
    join legislations l on l.id = ll.legislation_id
    join test_parameters tp on tp.id = ll.parameter_id
)
select
  short_name || ' (' || jurisdiction || '), parâmetro: ' || param_name
  || ' (' || param_code || '), matriz: '
  || case when applies_to_matrix = 'any' then 'todas as matrizes'
          else applies_to_matrix end
  || ', ' || limit_tier || ', ' || basis
  || ', publicado: ' || published_form
  || ', normalizado: ' || canonical_form
  || ', vigência: ' || case
       when coalesce(effective_from, publication_date) is null
         then 'não registrada'
       else 'publicada em ' || to_char(coalesce(effective_from, publication_date), 'DD/MM/YYYY')
            || ' (vigência não registrada)'
     end
  || '.' as citation_line
from x
where (code = 'CONAMA-357-2005' and param_code = 'arsenic')
   or (code = 'EPA-NPDWR' and param_code = 'lead' and limit_tier = 'action_level')
   or (code = 'WHO-GDWQ' and param_code = 'nitrate_as_n')
   or (code = 'EU-2020-2184' and param_code = 'turbidity')
order by code, param_code;
```

The SQL is a **structural** reference: it proves every field is reachable, but
it prints raw `matrix` / `limit_tier` / `basis` and C-locale decimals (`0.01`).
The examples above are the target output. Implementations must map the enums
through the label tables (`web/lib/format.mjs`) and format numbers/dates in
pt-BR before printing.

Post-PRO-13, `applies_to_matrix` is **NOT NULL**: use
`case when applies_to_matrix = 'any' then 'todas as matrizes' else ... end`
(there is no `NULL` to coalesce). A row scoped `surface` must not be printed for
a `tap` report and vice versa; that distinction is now real and legal, not an
omission.

---

## Key files

| Path | Role |
| ---- | ---- |
| `docs/PRO-5-report-output-spec.md` | this spec |
| `migrations/0002_core_schema.sql` | tables, verdict CHECK, both views |
| `migrations/0003_published_units.sql`, `0004_relax_ambiguous_canonical.sql` | published vs canonical units, ambiguity flag |
| `migrations/0005_matrix_scope.sql` | explicit `applies_to_matrix` (`any` = all), `limit_applies_to_matrix()` predicate ([PRO-13](/PRO/issues/PRO-13)) |
| `migrations/0006_composite_limits.sql` | `composite_limits` + `composite_limit_inputs`, deferred ≥2-input guardrail ([PRO-17](/PRO/issues/PRO-17)) |
| `seeds/0010`–`0040` | the 172 limits and their citations; scope backfills |
| `seeds/0050_composite_limits.sql` | the WHO ratio and EU sum rules (2 rules / 4 inputs), idempotent |
| `seeds/README.md` | conversion policy, 10 ambiguous rows, matrix scope, composite semantics, omissions |
| `web/lib/format.mjs` | shipped pt-BR verdict labels (`VERDICT_LABEL`), matrix labels, number/date formatting |
| `web/lib/data.mjs` | dashboard queries using `limit_applies_to_matrix()` |
| `web/pages/sample_detail.mjs`, `comparative.mjs` | current rendering of the states |

## How to verify

```bash
cd <waterquality-db workspace>   # Paperclip Onboarding _default
psql "$DATABASE_URL" -f /dev/stdin <<'SQL'
-- 3 stored verdicts only, and none against non-single-sample limits
select verdict, count(*) from compliance_verdicts where superseded_at is null group by 1;
select ll.basis, count(*) from compliance_verdicts cv
  join legislation_limits ll on ll.id = cv.legislation_limit_id
  where cv.superseded_at is null and ll.basis <> 'single_sample' group by 1;

-- matrix scope is explicit and the old NULL hole is gone (expected 0)
select count(*) from legislation_limits where applies_to_matrix is null;
select applies_to_matrix, count(*) from legislation_limits group by 1 order by 1;

-- no surface verdict against a tap-only law (expected 0)
select count(*) from compliance_verdicts cv
  join legislation_limits ll on ll.id = cv.legislation_limit_id
  join results r on r.id = cv.result_id
  join samples s on s.id = r.sample_id
  where cv.superseded_at is null
    and not limit_applies_to_matrix(s.matrix, ll.applies_to_matrix);

-- every limit has a verbatim citation and a document reference
select count(*) from legislation_limits ll join legislations l on l.id = ll.legislation_id
  where ll.citation is null or l.document_reference is null;

-- effective dates still missing (expected 4 / 172 today)
select count(*) filter (where effective_from is null), count(*) from legislations;
select count(*) filter (where effective_from is null), count(*) from legislation_limits;

-- multiple limits per (law, parameter): fluoride/copper/lead (expected 3 pairs)
select l.short_name, tp.code, count(*) from legislation_limits ll
  join legislations l on l.id = ll.legislation_id
  join test_parameters tp on tp.id = ll.parameter_id
  group by 1,2 having count(*) > 1 order by 1,2;

-- result table for the worked example: 11 rows, all CONAMA, 9/2/0
select cv.verdict, count(*) from compliance_verdicts cv
  join results r on r.id = cv.result_id
  join samples s on s.id = r.sample_id
  where s.code = 'DEMO-2026-010' and cv.superseded_at is null
  group by 1;

-- composite rules: 2 rules / 4 inputs, no rule with < 2 inputs, no ratio without divisor
select l.short_name, cl.rule_code, cl.rule_kind, cl.limit_value, cl.unit,
       count(cli.*) as inputs
from composite_limits cl
  join legislations l on l.id = cl.legislation_id
  left join composite_limit_inputs cli on cli.composite_limit_id = cl.id
group by 1,2,3,4,5 order by 1,2;
select count(*) from composite_limits cl
  where (select count(*) from composite_limit_inputs cli
          where cli.composite_limit_id = cl.id) < 2;
select count(*) from composite_limit_inputs cli
  join composite_limits cl on cl.id = cli.composite_limit_id
  where cl.rule_kind = 'ratio_sum' and cli.reference_value is null;

-- WHO ratio smoke on the tap samples
with r as (
  select s.code, cl.rule_code, cli.coefficient, cli.reference_value, r.value_numeric
  from samples s
    join results r on r.sample_id = s.id
    join test_parameters tp on tp.id = r.parameter_id
    join composite_limit_inputs cli on cli.parameter_id = tp.id
    join composite_limits cl on cl.id = cli.composite_limit_id
    join legislations l on l.id = cl.legislation_id
  where s.matrix = 'tap' and l.code = 'WHO-GDWQ' and r.data_status = 'final'
)
select code, round(sum(coefficient * value_numeric / reference_value), 4) as ratio_sum
from r group by code order by code;
SQL
```

Live snapshot (2026-10-21, post-PRO-17): **188** live verdicts, all
`basis='single_sample'`; **0** NULL matrix scopes; **0** surface verdicts
against WHO/EU/EPA; 172 limits, 4 laws, dates still NULL on both; **2**
composite rules / **4** inputs. WHO ratio on the tap samples: 0,5831 / 0,7134 /
0,8041 / 0,8635 (all Conforme); EU PCE+TCE has no measured inputs →
Indeterminado.

State coverage in the live demo data (2026-10-21):

- `Conforme`, `Não conforme`: `DEMO-2026-010` (surface, CONAMA only).
- `Indeterminado` + `pendente`: tap samples `DEMO-2026-003/006/009/012`,
  EU/WHO nitrate and nitrite (ambiguous canonical).
- `Sem limite aplicável`: `DEMO-2026-003/006/009/012`, dissolved oxygen (tap,
  no applicable limit) and every surface sample against WHO/EU/EPA. Also the
  tap samples against CONAMA.
- `Não avaliado`: **no live row** — every applicable limit has a live verdict.
  Use the PRO-14 scratch-DB fixtures (§3.2); never fabricate a row in the live
  DB or in production-like examples.

## 7. Open follow-ups

1. **DBEngineer sign-off — [PRO-14](/PRO/issues/PRO-14) (resolved 2026-10-21).**
   All 7 checklist items are **expressible**: applicability/matrix scoping,
   multiple limits per law/parameter, non-`single_sample` bases, citation
   fields, the §5 roll-up without a view change, `Sem limite aplicável` vs
   `Não avaliado`, and the edge cases. Three notes were folded into this
   revision: the matrix predicate (§2.1), the citation renderer's dead
   `coalesce` and tap-scoped examples (§6), and the §3.2 worked example (surface
   samples are CONAMA-only post-PRO-13). The remaining notes are contracts, not
   schema constraints — see item 10.
2. **CEO decision — binding law (resolved 2026-10-21).** A report must name the
   law it judges against. Implementation:
   - `target_legislation_id` is a **render-time parameter**, not a schema
     column; no migration today.
   - IST default: **CONAMA 357/2005** (Brazilian obligation); WHO/EU/EPA stay in
     the comparison table as reference.
   - The overall conclusion uses the binding law only; no target selected →
     **no overall conclusion**, per-law results only.
   - Promote to storage only when reports are persisted (item 6).
3. **`Não avaliado` fixture — [PRO-14](/PRO/issues/PRO-14) (resolved
   2026-10-21).** Two reproducible scratch-DB recipes validated and reverted
   (retire a verdict; insert a lead result on a tap sample). Details in §3.2.
   Neither is applied to the live DB.
4. **Frontend — [PRO-16](/PRO/issues/PRO-16), medium.** `/comparativo` and
   `/limites` currently print `limit_tier` and `basis` as raw enum codes
   (`maximum · running_average`) instead of the pt-BR labels required by
   §2.5/§4. Display-only fix.
5. **Board open item (CEO).** If IST already issues a paper report, send a
   copy; the rules above are fixed, the layout is negotiable.
6. **Report persistence (future).** There is no `reports` table; the spec
   defines a generated document only. If official issuance needs an audit trail
   (who issued, which rule version, which verdict rows), add a `reports` table
   and store the rendered snapshot — including `target_legislation_id`.
7. **Composite limits — [PRO-17](/PRO/issues/PRO-17) (resolved 2026-10-21).**
   The multi-input rule table exists (`composite_limits` +
   `composite_limit_inputs`, migration `0006`, seed `0050`) with the two real
   rules seeded. Reports must evaluate them per §2.9: missing/non-final input →
   **Indeterminado**, never **Sem limite aplicável**. The old "não modelado"
   fallback is retired.
8. **Report generator (next build) — [PRO-19](/PRO/issues/PRO-19), todo.** The
   rules, states and examples in this spec are what the generator must
   implement: per-sample report, comparison table, citations, and the composite
   `Regra composta` rows (`sum`/`ratio_sum`, missing input → **Indeterminado**).
   No schema change expected; no composite verdicts are stored in
   `compliance_verdicts`.
9. **Effective dates — [PRO-18](/PRO/issues/PRO-18), backlog (gated).** Do
   **not** populate `effective_from`/`effective_to` now (CEO decision,
   2026-10-21). The `não registrada` fallback in §6 is the permanent display
   until the trigger fires: historical samples are ingested, at which point the
   dates start changing verdicts. WHO guidelines must never get a legal
   effective date.
   The trigger is checkable, not a feeling:

   ```sql
   -- fires when there is a sample outside the 2026 demo horizon
   select code, collected_at from samples
    where code not like 'DEMO-%' or collected_at < date '2026-01-01'
    order by collected_at;
   ```

   Verified **0 rows** on 2026-10-21 (12 `DEMO-*` samples, all 2026).
   When it returns a row, run PRO-18: source the dates, propose the fill for
   CEO approval, then re-derive affected verdicts. Populate via idempotent
   seed/UPDATE (or a new migration if the model changes) — never edit an applied
   migration, and never invent a date for a guideline.
10. **Seed contracts not enforced by the schema (future migration, not
    blocking).** Unit equality (`results.unit = limit.unit`) and "ambiguous ⇒
    canonical NULL" hold today only because the seeds enforce them; the schema
    does not. The engine must check both at runtime (§2.1). If the company wants
    the database to guarantee them, add CHECK/trigger constraints in a future
    migration — out of scope for PRO-5/PRO-14.
