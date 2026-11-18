# Docs Index — Projeto IST

Índice vivo da documentação do projeto. Mantido pelo agente de Documentação.

| Issue | Documento | Resumo |
| --- | --- | --- |
| — | [README.md](./README.md) | Visão geral da pasta `docs/` e contexto do projeto |
| [PRO-5](/PRO/issues/PRO-5) | [PRO-5-report-output-spec.md](./PRO-5-report-output-spec.md) | Especificação v6 (final, sign-off PRO-14): relatório por amostra, leis de referência, escopo por matriz (PRO-13), vocabulário pt-BR dos 5 estados, regras compostas (PRO-17), vigência não registrada (PRO-18), tabela comparativa e citações |
| [PRO-19](/PRO/issues/PRO-19) | [PRO-19-gerador-relatorios.md](./PRO-19-gerador-relatorios.md) | Gerador do relatório por amostra em `/amostras/:code/relatorio`: rota e `?lei=`, blocos, decisões (lei vinculante, cobertura, compostos), arquivos e verificação |
| [PRO-6](/PRO/issues/PRO-6) | [PRO-6-dashboard-e-editor.md](./PRO-6-dashboard-e-editor.md) | Épico: como o pedido do board virou scaffold (PRO-7), dashboard (PRO-8) e editor CRUD (PRO-9); decisões comuns e follow-ups |
| [PRO-7](/PRO/issues/PRO-7) e [PRO-8](/PRO/issues/PRO-8) | [dashboard.md](./dashboard.md) | Dashboard de conformidade: como rodar, rotas, fontes de dados, regras de leitura, dados de demonstração, estrutura do código e limitações |
| [PRO-9](/PRO/issues/PRO-9) | [PRO-9-editor-crud-admin.md](./PRO-9-editor-crud-admin.md) | Registro de conclusão do editor CRUD: objetivo, entrega, decisões, arquivos-chave, verificação e follow-ups |
| [PRO-9](/PRO/issues/PRO-9) | [admin.md](./admin.md) | Referência técnica do `/admin`: rotas, validação em duas camadas, exclusão em duas etapas, aposentadoria de vereditos, `READ_ONLY=1`, limitações v1 |
| [PRO-10](/PRO/issues/PRO-10) | [PRO-10-criacao-banco.md](./PRO-10-criacao-banco.md) | Banco `sealimentar` criado a partir de `dadosBrutos/sqlBase.txt`: 22 tabelas, 26 FKs, como verificar e recriar |
| [PRO-2](/PRO/issues/PRO-2) · [PRO-3](/PRO/issues/PRO-3) · [PRO-4](/PRO/issues/PRO-4) | `_default/README.md` no workspace Onboarding | Fundação do banco: scaffold Postgres + pipeline de migrações/seeds, ERD e regras do schema (matriz, unidades, compostos), dataset multi-legislação com citações |

## Como esta pasta é mantida

Cada issue principal concluída deixa um documento `docs/<ISSUE-ID>-<slug>.md`
(nome do arquivo em português quando a issue é em português). Issues épicas
podem ter um documento próprio que amarra as sub-issues às referências
técnicas. Quando a issue é puramente infraestrutura, a referência técnica
existente (README do projeto de banco, por exemplo) conta como cobertura —
o índice aponta para ela em vez de duplicar o conteúdo. Páginas HTML
interativas entram apenas quando um visual — diagrama,
preview, comparativo — agrega de verdade. O processo de handoff está em
`DOCUMENTATION_PROCESS.md` no workspace de Onboarding.
