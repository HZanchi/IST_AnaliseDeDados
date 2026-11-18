# Projeto Aplicado — banco portátil + cadastro de laboratórios

Este guia explica duas coisas adicionadas ao projeto:

1. Como rodar o banco PostgreSQL de forma portátil (mesmo banco em qualquer
   máquina com Docker, dados guardados na raiz do projeto).
2. Como cadastrar laboratórios no editor do dashboard.

## 1. Banco portátil (Postgres via Docker)

O arquivo `docker-compose.yml` na raiz sobe um PostgreSQL 18 já configurado. Os
dados do banco ficam em `./pgdata` (dentro do projeto), então o estado "mora" na
raiz e acompanha o projeto quando ele é copiado/clonado.

Pré-requisito: Docker instalado (`docker --version`).

### Subir o banco

Na raiz do projeto:

```bash
docker compose up -d
```

No **primeiro** boot (quando `./pgdata` está vazio), o container cria o banco
`waterquality` e aplica, em ordem, os scripts de `web/db/init`:

- `01_schema.sql` — todo o esquema (tabelas, extensões, funções, triggers),
  incluindo a tabela nova `laboratories`.
- `02_data.sql` — os dados atuais (pontos, amostras, resultados, parâmetros,
  legislações e limites).

Nos boots seguintes, como já existe dado em `./pgdata`, os scripts de init são
ignorados e o banco sobe com o estado salvo — é assim que a persistência
funciona.

Conferir que subiu:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/health   # depois de iniciar o app (abaixo)
```

### Conexão

O dashboard lê `DATABASE_URL` de `web/.env`, já apontando para o container:

```
DATABASE_URL=postgres://waterquality:waterquality@127.0.0.1:5432/waterquality
```

As credenciais (`waterquality`/`waterquality`) batem com as do
`docker-compose.yml`. Em outra máquina, basta ter Docker, rodar
`docker compose up -d` e iniciar o app — nenhuma reconfiguração.

### Iniciar o dashboard

```bash
cd web
npm install        # primeira vez (instala o driver pg)
npm start          # sobe em http://127.0.0.1:3000
```

### Parar / resetar

```bash
docker compose down        # para o banco, mantém os dados em ./pgdata
docker compose down -v     # para e apaga o volume Docker (não o ./pgdata do host)
```

Para começar o banco do zero (reaplica schema + dados do init): pare o
container e apague a pasta de dados:

```bash
docker compose down
rm -rf pgdata        # CUIDADO: apaga o estado local do banco
docker compose up -d # recria a partir de web/db/init
```

> `pgdata/` está no `.gitignore` da raiz: é estado local, não vai para o git.

### Observação sobre a imagem postgres:18

Na imagem `postgres:18` o volume é montado em `/var/lib/postgresql` (e os dados
ficam numa subpasta por versão, ex. `pgdata/18/docker`), **não** mais em
`/var/lib/postgresql/data`. O `docker-compose.yml` já usa o caminho correto.

## 2. Cadastrar laboratórios

Foi criada a entidade **Laboratórios** no editor CRUD (`/admin`), no mesmo padrão
das demais (pontos, amostras, parâmetros, resultados, legislações, limites).

Fluxo:

1. Suba o banco (`docker compose up -d`) e o app (`cd web && npm start`).
2. Acesse `http://127.0.0.1:3000/admin`.
3. Clique no card **Laboratórios**.
4. Clique em **+ Novo laboratório**.
5. Preencha ao menos **Código** (único, ex. `LAB-01`) e **Nome** e salve.

Campos disponíveis: código, nome, CNPJ, acreditação (ex. ISO/IEC 17025),
contato (nome/e-mail/telefone), endereço, cidade, estado (UF), observações e
ativo. O e-mail de contato, quando preenchido, é validado no servidor e no
banco. Código duplicado é recusado com mensagem clara.

A tabela vive no banco como `laboratories`. O DDL versionado está em
`web/db/0007_laboratories.sql` (também já incluído no `01_schema.sql` do init).
