# PRO-10 — Criação do banco de dados (SEALIMENTAR)

Documentação da issue principal [PRO-10](/PRO/issues/PRO-10), concluída em
2026-10-16.

## Objetivo

O board pediu que o banco fosse criado a partir do DDL que já existia em
`dadosBrutos/sqlBase.txt` — o modelo lógico/físico **SEALIMENTAR**, gerado a
partir do modelo conceitual brModelo (`SEALIMENTAR.xml`), em dialeto
PostgreSQL.

## O que foi entregue

- Banco **`sealimentar`** criado em um PostgreSQL 18 local, dono `zanchi`,
  em `127.0.0.1:5432`.
- **22 tabelas** e **26 chaves estrangeiras** aplicadas exatamente como no DDL
  de origem, sem erros (`psql -v ON_ERROR_STOP=1`).
- Smoke test da cadeia principal
  (`estado → cidade → bairro → endereco → cliente → telefone_cliente`) em
  transação com `ROLLBACK`: OK.
- Banco deixado **vazio de dados** (apenas estrutura). Todas as 22 tabelas
  estão com 0 linhas.

Fonte da verdade do schema: `dadosBrutos/sqlBase.txt` (186 linhas).

## Modelo de dados

O domínio é o de um laboratório de análise de água: localização e clientes,
proposta comercial e amostras, legislação/classe/parâmetro/elemento, ensaios,
laboratório/técnico e parecer técnico.

| Grupo | Tabelas |
| --- | --- |
| Localização | `estado`, `cidade`, `bairro`, `endereco` |
| Cliente | `cliente`, `telefone_cliente` |
| Amostragem | `matriz`, `proposta_comercial`, `amostra` |
| Catálogo de análise | `unidade_medida`, `legislacao`, `classe`, `parametro`, `elemento` |
| Ensaios e laudos | `ensaio`, `laboratorio`, `tecnico`, `parecer_tecnico` |
| Associações N:N | `proposta_legislacao`, `legislacao_classe`, `classe_parametro`, `amostra_elemento` |

Relações centrais:

```
estado 1─n cidade 1─n bairro 1─n endereco
endereco 1─1 cliente 1─n telefone_cliente
cliente 1─n proposta_comercial n─1 matriz 1─1 endereco
proposta_comercial 1─n amostra n─1 matriz
amostra 1─n ensaio n─1 parametro
laboratorio 1─n tecnico 1─n parecer_tecnico n─1 ensaio
amostra n─n elemento            (amostra_elemento)
legislacao n─n classe           (legislacao_classe)
classe n─n parametro            (classe_parametro)
proposta_comercial n─n legislacao (proposta_legislacao)
```

Observações do DDL original:

- Chaves primárias são `SERIAL` (auto-incremento do PostgreSQL).
- `cliente.endereco`, `matriz.endereco` e `laboratorio.endereco` são relações
  1:1 (`UNIQUE`).
- `parametro` guarda `quantidade_maxima` e `quantidade_minima`; `elemento`
  liga o parâmetro a uma `unidade_medida`.
- `ensaio` é a entidade associativa entre `parametro` e `amostra` (no
  diagrama, "Compara"); `parecer_tecnico` associa `tecnico` e `ensaio`
  ("Analisa").
- O DDL tem um comentário mencionando `id_ensiao` no diagrama, mas a coluna
  criada é `id_ensaio`.

## Como rodar / verificar

Reconectar:

```bash
psql -d sealimentar
```

Conferir estrutura:

```bash
psql -d sealimentar -c "\dt"          # 22 tabelas
psql -d sealimentar -c "\d amostra"   # colunas e FKs de uma tabela
```

Contagens rápidas:

```bash
psql -d sealimentar -Atc \
  "select count(*) from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE';"   # 22
psql -d sealimentar -Atc \
  "select count(*) from information_schema.table_constraints
    where constraint_type='FOREIGN KEY' and table_schema='public';"  # 26
```

Recriar do zero (destrutivo — não rode se já houver dados):

```bash
cd /home/zanchi/Documents/projetoAplicado
dropdb sealimentar
createdb sealimentar
psql -v ON_ERROR_STOP=1 -d sealimentar -f dadosBrutos/sqlBase.txt
```

## Decisões e escopo

- **DDL existente como fonte da verdade.** A issue pedia para gerar o banco a
  partir do arquivo SQL, não para redesenhar o schema. O `sqlBase.txt` foi
  aplicado como estava.
- **Sem camada de migrations/seeds para este banco.** Diferente do banco
  `waterquality` (ver abaixo), o `sealimentar` foi criado por um script DDL
  único. Não existem `migrations/`, `seeds/` nem scripts npm para ele no
  workspace do Projeto IST.
- **Sem carga de dados.** O entregável é a estrutura; popular com dados reais
  é trabalho posterior.

## Relação com o banco `waterquality`

O workspace tem um segundo banco, `waterquality`, criado pelos projetos
[PRO-2](/PRO/issues/PRO-2) e [PRO-3](/PRO/issues/PRO-3) no workspace de
Onboarding (`waterquality-db`, com `migrations/`, `seeds/` e `scripts/`). Ele
alimenta o dashboard em `web/` (ver [dashboard.md](./dashboard.md)) e é um
schema diferente, não uma evolução do `sealimentar`.

Ou seja: as pastas `migrations/`, `seeds/` e `scripts/` **não** pertencem ao
PRO-10. O PRO-10 entregou apenas o banco `sealimentar` a partir de
`dadosBrutos/sqlBase.txt`.

## Arquivos-chave

- `dadosBrutos/sqlBase.txt` — DDL aplicado (modelo SEALIMENTAR).
- `docs/PRO-10-criacao-banco.md` — este documento.

## Follow-ups em aberto

- Definir se o `sealimentar` continuará sendo aplicado por DDL avulso ou se
  será migrado para o mesmo fluxo versionado (`migrations/` + `seeds/`) do
  `waterquality`.
- Carregar dados reais ou um seed de demonstração para o `sealimentar`.
- Resolver a convivência dos dois bancos no projeto (qual é o alvo do produto
  e do dashboard).
- Corrigir/normalizar a divergência `id_ensiao` (diagrama) × `id_ensaio`
  (DDL) se o modelo conceitual for reutilizado.
