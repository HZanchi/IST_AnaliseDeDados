/**
 * Relatório de ensaio por amostra (PRO-19) — renderização do contrato PRO-5.
 *
 * Blocos na ordem do template §3.3: cabeçalho, 1 resumo, 2 resultados,
 * 3 comparativo, 4 legenda, 5 citações, 6 responsável técnico.
 * A derivação de estados mora em `lib/report.mjs` (§2.8: nada aqui recalcula
 * veredito de `compliance_verdicts`; a regra composta do §2.9 é derivada na
 * camada de dados porque o agregado não é gravado no banco).
 */
import { escapeHtml, badge, table, layout, notice } from "../lib/html.mjs";
import {
  formatDateTimeBR,
  matrixLabel,
  sampleStatusLabel,
  limitTierLabel,
  basisLabel,
} from "../lib/format.mjs";
import {
  stateLabel,
  stateKind,
  publishedForm,
  canonicalForm,
  compositeExpression,
  LEGEND_ITEMS,
  resultCell,
} from "../lib/report.mjs";

function targetHref(report, token) {
  const base = `/amostras/${encodeURIComponent(report.sample.code)}/relatorio`;
  return token === null ? base : `${base}?lei=${encodeURIComponent(token)}`;
}

function lawSwitch(report) {
  const chips = report.laws
    .slice()
    .sort((a, b) => String(a.short_name).localeCompare(String(b.short_name), "pt-BR"))
    .map((law) => {
      const active = report.target && String(report.target.id) === String(law.id);
      return `<a class="law-chip${active ? " active" : ""}" href="${escapeHtml(
        targetHref(report, law.code),
      )}">${escapeHtml(law.short_name)}</a>`;
    })
    .join("");
  const noneActive = !report.target;
  return `<div class="report-switch no-print">
    <span class="muted small">Lei de referência (conclusão):</span>
    ${chips}
    <a class="law-chip${noneActive ? " active" : ""}" href="${escapeHtml(
      targetHref(report, null),
    )}">nenhuma (sem conclusão)</a>
  </div>`;
}

function situationLabel(report) {
  if (report.demo) return "DADOS DE DEMONSTRAÇÃO";
  const pending = report.results.some((r) => r.data_status !== "final");
  return pending ? "preliminar" : "oficial";
}

function headerBlock(report) {
  const { sample, provenance } = report;
  const lines = [
    [
      "Amostra",
      `<code>${escapeHtml(sample.code)}</code>${
        report.overall
          ? ` ${badge(
              stateKind(report.overall.state),
              stateLabel(report.overall.state),
            )}`
          : ""
      }`,
    ],
    [
      "Ponto",
      `${escapeHtml(sample.point_name)} (<code>${escapeHtml(sample.point_code)}</code>)${
        sample.region ? ` — ${escapeHtml(sample.region)}` : ""
      }${sample.water_body ? ` · ${escapeHtml(sample.water_body)}` : ""}`,
    ],
    ["Matriz", escapeHtml(matrixLabel(sample.matrix))],
    [
      "Coletada em",
      `${escapeHtml(formatDateTimeBR(sample.collected_at))} <span class="muted">(America/Sao_Paulo)</span>`,
    ],
    ["Responsável", escapeHtml(sample.collected_by || "não informado")],
    ["Situação", `<strong>${escapeHtml(situationLabel(report))}</strong>`],
    [
      "Regra",
      provenance.ruleVersions.length
        ? provenance.ruleVersions.map(escapeHtml).join(", ")
        : "não registrada",
    ],
    [
      "Fonte",
      `${escapeHtml(provenance.database)} @ ${escapeHtml(report.extractedAtLabel)}`,
    ],
  ];

  return `<section class="report-head">
    <div class="report-title">
      <h1>RELATÓRIO DE ENSAIO — AMOSTRA <code>${escapeHtml(sample.code)}</code></h1>
      ${table({ head: ["Campo", "Valor"], rows: lines })}
    </div>
    <div class="report-id"><code>${escapeHtml(report.reportId)}</code></div>
  </section>`;
}

function summarySection(report) {
  const { target, overall } = report;

  const perLawRows = report.perLaw.map((row) => [
    escapeHtml(row.law.short_name),
    row.counts ? String(row.counts.compliant_count) : "—",
    row.counts ? String(row.counts.non_compliant_count) : "—",
    row.counts ? String(row.counts.indeterminate_count) : "—",
    `${badge(stateKind(row.state), stateLabel(row.state))}${
      row.hint ? ` <span class="muted small">(${escapeHtml(row.hint)})</span>` : ""
    }`,
  ]);

  const head = `
    <p class="report-line"><strong>Lei de referência:</strong> ${
      target
        ? `<strong>${escapeHtml(target.short_name)}</strong>`
        : `<span class="muted">— (sem conclusão geral)</span>`
    }</p>`;

  const body = target
    ? `<p class="report-line"><strong>Geral:</strong> ${badge(
        stateKind(overall.state),
        stateLabel(overall.state),
      )} <span class="muted">(${escapeHtml(target.short_name)})</span></p>
       <p class="report-line"><strong>Cobertura:</strong> ${overall.coverage.covered} de ${
         overall.coverage.total
       } resultados com limite aplicável (${escapeHtml(target.short_name)})${
         overall.state === "no_limit"
           ? ` <span class="muted">— nenhum resultado é coberto por ${escapeHtml(
               target.short_name,
             )} nesta matriz/data</span>`
           : ""
       }</p>`
    : notice({
        tone: "warn",
        title: "Sem conclusão geral.",
        body: "Nenhuma lei de referência foi selecionada: o relatório emite apenas os resultados por legislação (PRO-5 §5.2). Comparar contra \"todas as leis em pé de igualdade\" declararia a amostra não conforme contra uma norma estrangeira que o laboratório não precisa cumprir.",
      });

  return `<section>
    <h2>1. Resumo de veredito</h2>
    ${head}
    ${body}
    ${table({
      head: [
        "Legislação",
        "Conformes",
        "Não conformes",
        "Indeterminados",
        "Veredito",
      ],
      rows: perLawRows,
    })}
  </section>`;
}

function verdictCell(row) {
  const { limit, state } = row;
  const bits = [badge(stateKind(state), stateLabel(state))];
  if (limit?.reason) {
    bits.push(`<br><span class="muted small">${escapeHtml(limit.reason)}</span>`);
  }
  if (limit && limit.limit_kind === "text" && limit.evaluated_by) {
    bits.push(
      `<br><span class="muted small">avaliado por ${escapeHtml(limit.evaluated_by)}</span>`,
    );
  }
  if (limit && limit.basis !== "single_sample") {
    bits.push(
      `<br><span class="muted small">base: ${escapeHtml(basisLabel(limit.basis))}${
        limit.assessment_window ? ` · janela: ${escapeHtml(limit.assessment_window)}` : ""
      }</span>`,
    );
  }
  return bits.join("");
}

function parameterCell(result) {
  return `${escapeHtml(result.parameter_name)} <span class="muted small">${escapeHtml(
    result.parameter_code,
  )}</span>${
    result.replicate > 1
      ? ` <span class="muted small">· repetição ${result.replicate}</span>`
      : ""
  }`;
}

function resultsSection(report) {
  const rows = report.resultRows.map((row) => {
    const { result, limit, state, composite } = row;

    if (composite) {
      // §3.1/§2.9 — uma linha `Regra composta` por (amostra, regra), depois
      // das linhas por resultado; a expressão e o estado vêm de `evaluation`.
      const ev = composite.evaluation || row.evaluation;
      const inputs = composite.input_codes || [];
      return [
        `Regra composta <code>${escapeHtml(composite.rule_code)}</code>`,
        escapeHtml(compositeExpression(composite)),
        escapeHtml(composite.legislation_short_name),
        escapeHtml(publishedForm(composite, { operator: true })),
        composite.conversion_status === "ambiguous"
          ? `— ${badge("warn", "pendente")}`
          : escapeHtml(canonicalForm(composite, { operator: true })),
        `${escapeHtml(limitTierLabel(composite.limit_tier))} / ${escapeHtml(
          basisLabel(composite.basis),
        )}`,
        `${badge(stateKind(state), stateLabel(state))}${
          ev?.valueLabel
            ? `<br><span class="muted small">resultado da expressão: ${escapeHtml(
                ev.valueLabel,
              )}</span>`
            : ""
        }${
          ev?.reason
            ? `<br><span class="muted small">${escapeHtml(ev.reason)}</span>`
            : ""
        }${
          inputs.length
            ? `<br><span class="muted small">entradas: ${inputs
                .map((code) => `<code>${escapeHtml(code)}</code>`)
                .join(", ")}</span>`
            : ""
        }`,
      ];
    }

    const param = parameterCell(result);
    const value = escapeHtml(resultCell(result));

    if (!limit) {
      return [param, value, "—", "—", "—", "—", badge(stateKind(state), stateLabel(state))];
    }
    const pending = limit.conversion_status === "ambiguous";
    return [
      param,
      value,
      escapeHtml(limit.legislation_short_name),
      escapeHtml(publishedForm(limit, { operator: true })),
      pending
        ? `— ${badge("warn", "pendente")}`
        : escapeHtml(canonicalForm(limit, { operator: true })),
      `${escapeHtml(limitTierLabel(limit.limit_tier))} / ${escapeHtml(basisLabel(limit.basis))}`,
      verdictCell(row),
    ];
  });

  return `<section>
    <h2>2. Resultados</h2>
    ${table({
      head: [
        "Parâmetro",
        "Resultado",
        "Lei",
        "Limite publicado",
        "Limite normalizado",
        "Nível/base",
        "Veredito",
      ],
      rows,
      empty: "Nenhum resultado para esta amostra.",
    })}
    <p class="muted small">Uma linha por (resultado, limite aplicável) julgado — PRO-5 §3.1 — mais uma linha <em>Regra composta</em> por (amostra, regra) aplicável, depois das demais (§2.9). Limites de base diferente de <em>amostra individual</em> nunca imprimem Conforme/Não conforme; a regra composta é de nível de amostra e não muda o denominador <em>N de M resultados</em>.</p>
  </section>`;
}

function comparisonSection(report) {
  const head = [
    "Parâmetro",
    ...report.columns.map((column) => {
      const marker = report.target
        ? `<br><span class="muted small">${column.isTarget ? "principal" : "referência"}</span>`
        : "";
      return `${escapeHtml(column.law.short_name)}${marker}`;
    }),
  ];

  const rows = report.comparison.map(({ result, cells }) => [
    parameterCell(result),
    ...cells.map(({ lines }) => {
      const rendered = lines.map((line) => {
        if (line.kind === "limit" || line.kind === "composite") {
          return `<div class="cmp-line">${escapeHtml(line.text)} → ${badge(
            stateKind(line.state),
            stateLabel(line.state),
          )}</div>`;
        }
        return `<div class="cmp-line cmp-note">${escapeHtml(line.text)}</div>`;
      });
      return `<div class="cmp-cell">${rendered.join("")}</div>`;
    }),
  ]);

  // §4 — bloco à parte depois da tabela: uma linha por (amostra, regra) com a
  // expressão e o estado; a regra abrange dois parâmetros e não cabe numa célula.
  const compositeBlock = report.composites.length
    ? `<div class="composite-block">
        <h3>Regras compostas</h3>
        ${table({
          head: ["Regra", "Lei", "Expressão", "Publicado", "Nível/base", "Veredito"],
          rows: report.composites.map((composite) => {
            const ev = composite.evaluation || {};
            return [
              `<code>${escapeHtml(composite.rule_code)}</code>`,
              escapeHtml(composite.legislation_short_name),
              `${escapeHtml(compositeExpression(composite))}${
                ev.valueLabel
                  ? ` · <strong>${escapeHtml(ev.valueLabel)}</strong>`
                  : ""
              }`,
              escapeHtml(publishedForm(composite, { operator: true })),
              `${escapeHtml(limitTierLabel(composite.limit_tier))} / ${escapeHtml(
                basisLabel(composite.basis),
              )}`,
              `${badge(stateKind(ev.state), stateLabel(ev.state))}${
                ev.reason
                  ? `<br><span class="muted small">${escapeHtml(ev.reason)}</span>`
                  : ""
              }`,
            ];
          }),
        })}
        <p class="muted small">Uma linha por (amostra, regra) aplicável — PRO-5 §4. O agregado é derivado na emissão (§2.9), nunca deduzido dos vereditos individuais e nunca rotulado "Sem limite aplicável".</p>
      </div>`
    : "";

  return `<section>
    <h2>3. Comparativo entre legislações</h2>
    ${table({ head, rows, empty: "Sem resultados para comparar." })}
    ${compositeBlock}
    <p class="muted small">Cada célula é uma lista: uma lei pode ter mais de um limite para o mesmo parâmetro (PRO-5 §4). Não existe coluna de "lei mais restritiva" — o relatório nunca escolhe uma lei por conta própria.</p>
  </section>`;
}

function legendSection() {
  const items = LEGEND_ITEMS.map(
    (item) =>
      `<li>${badge(stateKind(item.state), stateLabel(item.state))} <span>${escapeHtml(
        item.text,
      )}</span></li>`,
  ).join("");
  return `<section>
    <h2>4. Legenda</h2>
    <ul class="legend">${items}
      <li>${badge("warn", "pendente")} <span>qualificador do limite, não um veredito: a forma canônica está ambígua e a publicada permanece visível (PRO-5 §1)</span></li>
    </ul>
    <p class="muted small">Os cinco estados nunca se fundem: "Sem limite aplicável" não é conformidade e "Não avaliado" não é "Indeterminado". Um traço onde a distinção pertence é um defeito, não um atalho.</p>
  </section>`;
}

function citationsSection(report) {
  const entries = report.citations.map(
    (entry) => `<li class="citation">
      <p class="citation-line">${escapeHtml(entry.layer1)}</p>
      <p class="citation-source">${escapeHtml(entry.layer2)}</p>
    </li>`,
  );

  return `<section>
    <h2>5. Citações (${report.citations.length})</h2>
    <ol class="citations">${entries.join("")}</ol>
    <p class="muted small">Camada 1 composta, camada 2 verbatim da fonte (PRO-5 §6) — limites e regras compostas na mesma lista. Toda linha julgada tem de ter citação aqui — sem nomear o limite aplicado, o relatório não é emitido.</p>
  </section>`;
}

function signatureSection(report) {
  return `<section>
    <h2>6. Responsável técnico</h2>
    <div class="signature">
      <p>Nome: <span class="sign-line"></span> Registro: <span class="sign-line sign-short"></span> Data: <span class="sign-line sign-date"></span></p>
      <p class="muted small">Emissão: ${escapeHtml(report.reportId)} · gerado em ${escapeHtml(
        report.extractedAtLabel,
      )} (America/Sao_Paulo) · não persistido (PRO-5 §7 item 6).</p>
    </div>
  </section>`;
}

function provenanceFooter(report) {
  const { provenance } = report;
  const rules = provenance.ruleVersions.length
    ? provenance.ruleVersions.join(", ")
    : "não registrado";
  const by = provenance.evaluatedBy.length
    ? provenance.evaluatedBy.join(", ")
    : "não registrado";
  return `<p class="report-provenance">
    <strong>Regra:</strong> ${escapeHtml(rules)}
    · <strong>Avaliado por:</strong> ${escapeHtml(by)}
    · <strong>Fonte:</strong> ${escapeHtml(provenance.database)} @ ${escapeHtml(
      report.extractedAtLabel,
    )}
    · <strong>Extração:</strong> relatório gerado sob demanda, sem gravação
  </p>`;
}

export function renderReport(report) {
  const demoBlock = report.demo
    ? `${notice({
        tone: "warn",
        title: "DADOS DE DEMONSTRAÇÃO.",
        body: "Este relatório usa linhas/vereditos de demonstração e <strong>não é um relatório oficial de conformidade</strong> (PRO-5 §2.7).",
      })}<div class="report-watermark" aria-hidden="true">DADOS DE DEMONSTRAÇÃO</div>`
    : "";

  const body = `<div class="report">
    ${demoBlock}
    <div class="report-actions no-print">
      <a class="btn" href="/amostras/${escapeHtml(
        encodeURIComponent(report.sample.code),
      )}">← Amostra</a>
      <button class="btn btn-primary" type="button" onclick="window.print()">Imprimir / PDF</button>
    </div>
    ${headerBlock(report)}
    ${lawSwitch(report)}
    ${summarySection(report)}
    ${resultsSection(report)}
    ${comparisonSection(report)}
    ${legendSection()}
    ${citationsSection(report)}
    ${signatureSection(report)}
    ${provenanceFooter(report)}
  </div>`;

  return layout({
    title: `Relatório ${report.reportId} — ${report.sample.code}`,
    active: "samples",
    subtitle:
      "Relatório de ensaio gerado sob demanda a partir do banco waterquality — contrato PRO-5 (spec v6).",
    body,
  });
}
