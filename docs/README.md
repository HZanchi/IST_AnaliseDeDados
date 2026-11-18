# Documentação — Projeto IST

Tudo que é feito neste projeto fica documentado aqui (regra do próprio projeto:
“Tudo que for feito nesse projeto deve ser documentado na pasta `docs`”).

| Documento | Conteúdo |
| --- | --- |
| [INDEX.md](INDEX.md) | Índice de toda a documentação do projeto |
| [PRO-6-dashboard-e-editor.md](PRO-6-dashboard-e-editor.md) | Épico do dashboard e do editor: pedido do board, entregas de PRO-7/PRO-8/PRO-9, decisões comuns e follow-ups |
| [dashboard.md](dashboard.md) | Dashboard de conformidade: como rodar, rotas, fontes de dados, regras de leitura, dados de demonstração, estrutura do código e limitações |
| [PRO-9-editor-crud-admin.md](PRO-9-editor-crud-admin.md) | Registro de conclusão do editor CRUD `/admin`: entrega, decisões, arquivos-chave, verificação e follow-ups |
| [admin.md](admin.md) | Editor de dados `/admin`: rotas CRUD, validação em duas camadas, exclusão em duas etapas, aposentadoria de vereditos, modo `READ_ONLY=1` e limitações da v1 |
| [PRO-5-report-output-spec.md](PRO-5-report-output-spec.md) | Especificação v6 do relatório por amostra: lei de referência, escopo por matriz, 5 estados de veredito em pt-BR, regras compostas (PRO-17), vigência não registrada (PRO-18), tabela comparativa e citações |
| [PRO-19-gerador-relatorios.md](PRO-19-gerador-relatorios.md) | Gerador do relatório por amostra: rota `/amostras/:code/relatorio`, `?lei=`, blocos do relatório, arquitetura, arquivos-chave, verificação e follow-ups |
| [PRO-10-criacao-banco.md](PRO-10-criacao-banco.md) | Banco `sealimentar` criado a partir de `dadosBrutos/sqlBase.txt` (22 tabelas, 26 FKs, verificação e recriação) |
| `_default/README.md` (workspace Onboarding) | Fundação do banco (PRO-2/PRO-3/PRO-4): scaffold Postgres, pipeline de migrações/seeds, ERD e regras do schema, dataset multi-legislação com citações |

## Contexto rápido

- **Dados brutos** em `../dadosBrutos/` (CSVs de limites por legislação) e
  `../sqlBase.txt` (modelo SEALIMENTAR).
- **Banco PostgreSQL** `waterquality` — schema, migrações e seeds ficam no
  projeto de dados do workspace de Onboarding (pacote `waterquality-db`, pasta
  `_default` do projeto Onboarding no workspace do Paperclip).
- **Aplicação web** em `../web/` — dashboard em HTML que lê esse banco + editor
  CRUD em `/admin` para criar/editar/excluir registros pela interface.
