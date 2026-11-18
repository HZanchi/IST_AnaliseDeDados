-- 0007_laboratories.sql
-- Tabela de laboratórios: catálogo de laboratórios que executam os ensaios.
-- Até aqui "laboratório" era apenas um campo de texto livre em results.laboratory;
-- esta tabela passa a ser a entidade de referência, editável pelo CRUD (/admin/laboratorios).
--
-- Segue o padrão das demais tabelas do waterquality:
--   id uuid gen_random_uuid(), code citext único, metadata jsonb, created_at/updated_at
--   com o gatilho set_updated_at(). Requer as extensões pgcrypto e citext (migration 0001).

CREATE TABLE IF NOT EXISTS laboratories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            citext NOT NULL UNIQUE,
    name            text   NOT NULL,
    cnpj            text,
    accreditation   text,                 -- acreditação / número ISO 17025, se houver
    contact_name    text,
    contact_email   text,
    contact_phone   text,
    address         text,
    city            text,
    state           text,
    notes           text,
    active          boolean NOT NULL DEFAULT true,
    metadata        jsonb   NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT laboratories_email_chk
        CHECK (contact_email IS NULL OR contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE INDEX IF NOT EXISTS laboratories_name_idx ON laboratories (name);

DROP TRIGGER IF EXISTS laboratories_set_updated_at ON laboratories;
CREATE TRIGGER laboratories_set_updated_at
    BEFORE UPDATE ON laboratories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO schema_migrations (name)
VALUES ('0007_laboratories.sql')
ON CONFLICT (name) DO NOTHING;
