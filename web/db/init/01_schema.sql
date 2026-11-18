--
-- PostgreSQL database dump
--

\restrict sn5KaHvhhpjmukLMksc4xnpMQBgv6dsi8AW82IFGcMuUEzZ8rzQO4Ttu8CtWcbD

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: water_matrix; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.water_matrix AS text
	CONSTRAINT water_matrix_check CHECK ((VALUE = ANY (ARRAY['surface'::text, 'ground'::text, 'tap'::text, 'effluent'::text, 'marine'::text, 'precipitation'::text, 'other'::text, 'any'::text])));


--
-- Name: DOMAIN water_matrix; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON DOMAIN public.water_matrix IS 'Matriz de água. Valores físicos (surface/ground/tap/effluent/marine/precipitation/other) ou ''any'' = escopo deliberado "cobre todas as matrizes" (PRO-13). NULL não é possível nas colunas NOT NULL; em legislation_limits.applies_to_matrix a coluna é NOT NULL.';


--
-- Name: composite_limit_inputs_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.composite_limit_inputs_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rid uuid := COALESCE(NEW.composite_limit_id, OLD.composite_limit_id);
  rk  text;
BEGIN
  SELECT rule_kind INTO rk FROM composite_limits WHERE id = rid;
  IF rk IS NULL THEN
    RETURN NULL; -- regra removida em cascata — nada a validar
  END IF;
  IF (SELECT count(*) FROM composite_limit_inputs WHERE composite_limit_id = rid) < 2 THEN
    RAISE EXCEPTION 'regra composta % precisa de >= 2 entradas (PRO-17)', rid;
  END IF;
  IF rk = 'ratio_sum' AND EXISTS (
       SELECT 1 FROM composite_limit_inputs
        WHERE composite_limit_id = rid AND reference_value IS NULL) THEN
    RAISE EXCEPTION 'regra ratio_sum % exige reference_value em toda entrada (PRO-17)', rid;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: limit_applies_to_matrix(public.water_matrix, public.water_matrix); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limit_applies_to_matrix(p_sample_matrix public.water_matrix, p_limit_scope public.water_matrix) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT p_limit_scope IS NOT NULL
     AND (p_limit_scope = 'any' OR p_limit_scope = p_sample_matrix);
$$;


--
-- Name: FUNCTION limit_applies_to_matrix(p_sample_matrix public.water_matrix, p_limit_scope public.water_matrix); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.limit_applies_to_matrix(p_sample_matrix public.water_matrix, p_limit_scope public.water_matrix) IS 'Regra única de escopo de matriz (PRO-13): o limite julga a amostra quando o escopo é ''any'' (deliberado, todas as matrizes) ou igual à matriz da amostra. NULL não casa. Seed, dashboard e derivação de vereditos devem usar esta função.';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: compliance_verdicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_verdicts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    result_id uuid NOT NULL,
    legislation_limit_id uuid NOT NULL,
    verdict text NOT NULL,
    evaluated_value_numeric numeric,
    evaluated_value_text public.citext,
    evaluated_unit text,
    reason text,
    limit_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    rule_version text,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    evaluated_by text DEFAULT 'system'::text NOT NULL,
    superseded_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compliance_verdicts_verdict_check CHECK ((verdict = ANY (ARRAY['compliant'::text, 'non_compliant'::text, 'indeterminate'::text])))
);


--
-- Name: composite_limit_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.composite_limit_inputs (
    composite_limit_id uuid NOT NULL,
    parameter_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    coefficient numeric DEFAULT 1 NOT NULL,
    reference_published_value numeric,
    reference_published_unit text,
    reference_value numeric,
    reference_unit text,
    conversion_status text DEFAULT 'exact'::text NOT NULL,
    conversion_note text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT composite_limit_inputs_check CHECK (((conversion_status = ANY (ARRAY['exact'::text, 'not_applicable'::text])) OR ((conversion_status = ANY (ARRAY['converted'::text, 'ambiguous'::text])) AND (conversion_note IS NOT NULL)))),
    CONSTRAINT composite_limit_inputs_check1 CHECK (((reference_value IS NULL) = (reference_published_value IS NULL))),
    CONSTRAINT composite_limit_inputs_coefficient_check CHECK ((coefficient > (0)::numeric)),
    CONSTRAINT composite_limit_inputs_conversion_status_check CHECK ((conversion_status = ANY (ARRAY['exact'::text, 'converted'::text, 'ambiguous'::text, 'not_applicable'::text]))),
    CONSTRAINT composite_limit_inputs_ordinal_check CHECK ((ordinal >= 1)),
    CONSTRAINT composite_limit_inputs_reference_value_check CHECK (((reference_value IS NULL) OR (reference_value > (0)::numeric)))
);


--
-- Name: TABLE composite_limit_inputs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.composite_limit_inputs IS 'Termos de uma regra composta: parâmetro + coeficiente + referência (publicada e canônica, para razões). Mínimo 2 por regra (trigger adiado).';


--
-- Name: composite_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.composite_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legislation_id uuid NOT NULL,
    rule_code text NOT NULL,
    rule_kind text NOT NULL,
    limit_kind text DEFAULT 'max'::text NOT NULL,
    limit_value numeric,
    limit_lower numeric,
    limit_upper numeric,
    limit_text public.citext,
    unit text,
    applies_to_matrix public.water_matrix NOT NULL,
    limit_tier text DEFAULT 'maximum'::text NOT NULL,
    basis text DEFAULT 'single_sample'::text NOT NULL,
    assessment_window text,
    max_non_compliance_count integer,
    max_non_compliance_rate numeric,
    citation text,
    effective_from date,
    effective_to date,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_value numeric,
    published_lower numeric,
    published_upper numeric,
    published_unit text,
    conversion_status text DEFAULT 'exact'::text NOT NULL,
    conversion_note text,
    CONSTRAINT composite_limits_basis_check CHECK ((basis = ANY (ARRAY['single_sample'::text, 'running_average'::text, 'periodic_average'::text, 'frequency'::text]))),
    CONSTRAINT composite_limits_check CHECK ((((limit_kind = 'max'::text) AND (limit_value IS NOT NULL) AND (limit_lower IS NULL) AND (limit_upper IS NULL) AND (limit_text IS NULL)) OR ((limit_kind = 'min'::text) AND (limit_value IS NOT NULL) AND (limit_lower IS NULL) AND (limit_upper IS NULL) AND (limit_text IS NULL)) OR ((limit_kind = 'range'::text) AND (limit_lower IS NOT NULL) AND (limit_upper IS NOT NULL) AND (limit_value IS NULL) AND (limit_text IS NULL) AND (limit_lower <= limit_upper)) OR ((limit_kind = 'text'::text) AND (limit_text IS NOT NULL) AND (limit_value IS NULL) AND (limit_lower IS NULL) AND (limit_upper IS NULL)))),
    CONSTRAINT composite_limits_check1 CHECK (((limit_kind = 'text'::text) OR (rule_kind = 'ratio_sum'::text) OR (unit IS NOT NULL))),
    CONSTRAINT composite_limits_check2 CHECK (((conversion_status = ANY (ARRAY['exact'::text, 'not_applicable'::text])) OR ((conversion_status = ANY (ARRAY['converted'::text, 'ambiguous'::text])) AND (conversion_note IS NOT NULL)))),
    CONSTRAINT composite_limits_check3 CHECK (((limit_kind = 'text'::text) OR (conversion_status = 'ambiguous'::text) OR (published_value IS NOT NULL))),
    CONSTRAINT composite_limits_check4 CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT composite_limits_conversion_status_check CHECK ((conversion_status = ANY (ARRAY['exact'::text, 'converted'::text, 'ambiguous'::text, 'not_applicable'::text]))),
    CONSTRAINT composite_limits_limit_kind_check CHECK ((limit_kind = ANY (ARRAY['max'::text, 'min'::text, 'range'::text, 'text'::text]))),
    CONSTRAINT composite_limits_limit_tier_check CHECK ((limit_tier = ANY (ARRAY['maximum'::text, 'aesthetic'::text, 'action_level'::text, 'treatment_technique'::text, 'guideline'::text]))),
    CONSTRAINT composite_limits_max_non_compliance_count_check CHECK (((max_non_compliance_count IS NULL) OR (max_non_compliance_count >= 0))),
    CONSTRAINT composite_limits_max_non_compliance_rate_check CHECK (((max_non_compliance_rate IS NULL) OR ((max_non_compliance_rate >= (0)::numeric) AND (max_non_compliance_rate <= (1)::numeric)))),
    CONSTRAINT composite_limits_rule_kind_check CHECK ((rule_kind = ANY (ARRAY['sum'::text, 'ratio_sum'::text])))
);


--
-- Name: TABLE composite_limits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.composite_limits IS 'Regras de limite multi-entrada (PRO-17): expressões que não cabem em legislation_limits (soma OMS NO3+NO2, soma UE PCE+TCE). Motor de derivação: PRO-5.';


--
-- Name: COLUMN composite_limits.rule_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.composite_limits.rule_kind IS 'sum: Σ coef×valor ≤ limit_value. ratio_sum: Σ coef×(valor/reference_value) ≤ limit_value. Avaliar só com entradas finais da mesma amostra; dado faltante ⇒ indeterminate, nunca "Sem limite aplicável".';


--
-- Name: laboratories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.laboratories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code public.citext NOT NULL,
    name text NOT NULL,
    cnpj text,
    accreditation text,
    contact_name text,
    contact_email text,
    contact_phone text,
    address text,
    city text,
    state text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT laboratories_email_chk CHECK (((contact_email IS NULL) OR (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)))
);


--
-- Name: legislation_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legislation_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legislation_id uuid NOT NULL,
    parameter_id uuid NOT NULL,
    limit_kind text DEFAULT 'max'::text NOT NULL,
    limit_value numeric,
    limit_lower numeric,
    limit_upper numeric,
    limit_text public.citext,
    unit text,
    applies_to_matrix public.water_matrix NOT NULL,
    limit_tier text DEFAULT 'maximum'::text NOT NULL,
    basis text DEFAULT 'single_sample'::text NOT NULL,
    assessment_window text,
    max_non_compliance_count integer,
    max_non_compliance_rate numeric,
    citation text,
    effective_from date,
    effective_to date,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_value numeric,
    published_lower numeric,
    published_upper numeric,
    published_unit text,
    conversion_status text DEFAULT 'exact'::text NOT NULL,
    conversion_note text,
    CONSTRAINT legislation_limits_basis_check CHECK ((basis = ANY (ARRAY['single_sample'::text, 'running_average'::text, 'periodic_average'::text, 'frequency'::text]))),
    CONSTRAINT legislation_limits_check CHECK ((((limit_kind = 'max'::text) AND (limit_lower IS NULL) AND (limit_upper IS NULL) AND (limit_text IS NULL) AND ((limit_value IS NOT NULL) OR (conversion_status = 'ambiguous'::text))) OR ((limit_kind = 'min'::text) AND (limit_lower IS NULL) AND (limit_upper IS NULL) AND (limit_text IS NULL) AND ((limit_value IS NOT NULL) OR (conversion_status = 'ambiguous'::text))) OR ((limit_kind = 'range'::text) AND (limit_text IS NULL) AND (((limit_lower IS NOT NULL) AND (limit_upper IS NOT NULL) AND (limit_value IS NULL) AND (limit_lower <= limit_upper)) OR ((conversion_status = 'ambiguous'::text) AND (limit_value IS NULL) AND (limit_lower IS NULL) AND (limit_upper IS NULL)))) OR ((limit_kind = 'text'::text) AND (limit_text IS NOT NULL) AND (limit_value IS NULL) AND (limit_lower IS NULL) AND (limit_upper IS NULL)))),
    CONSTRAINT legislation_limits_check1 CHECK (((limit_kind = 'text'::text) OR (unit IS NOT NULL))),
    CONSTRAINT legislation_limits_check2 CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT legislation_limits_conversion_note_chk CHECK ((((conversion_status = 'ambiguous'::text) AND (conversion_note IS NOT NULL)) OR ((conversion_status = 'converted'::text) AND (conversion_note IS NOT NULL)) OR (conversion_status = ANY (ARRAY['exact'::text, 'not_applicable'::text])))),
    CONSTRAINT legislation_limits_conversion_status_check CHECK ((conversion_status = ANY (ARRAY['exact'::text, 'converted'::text, 'ambiguous'::text, 'not_applicable'::text]))),
    CONSTRAINT legislation_limits_limit_kind_check CHECK ((limit_kind = ANY (ARRAY['max'::text, 'min'::text, 'range'::text, 'text'::text]))),
    CONSTRAINT legislation_limits_limit_tier_check CHECK ((limit_tier = ANY (ARRAY['maximum'::text, 'aesthetic'::text, 'action_level'::text, 'treatment_technique'::text, 'guideline'::text]))),
    CONSTRAINT legislation_limits_max_non_compliance_count_check CHECK (((max_non_compliance_count IS NULL) OR (max_non_compliance_count >= 0))),
    CONSTRAINT legislation_limits_max_non_compliance_rate_check CHECK (((max_non_compliance_rate IS NULL) OR ((max_non_compliance_rate >= (0)::numeric) AND (max_non_compliance_rate <= (1)::numeric)))),
    CONSTRAINT legislation_limits_published_numeric_chk CHECK (((limit_kind = 'text'::text) OR ((unit IS NOT NULL) AND (published_unit IS NOT NULL) AND (((limit_kind = ANY (ARRAY['max'::text, 'min'::text])) AND (published_value IS NOT NULL) AND (published_lower IS NULL) AND (published_upper IS NULL)) OR ((limit_kind = 'range'::text) AND (published_value IS NULL) AND (published_lower IS NOT NULL) AND (published_upper IS NOT NULL))))))
);


--
-- Name: COLUMN legislation_limits.applies_to_matrix; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.legislation_limits.applies_to_matrix IS 'Escopo de matriz que este limite cobre — NOT NULL desde 0005 (PRO-13). ''any'' = deliberadamente agnóstico (cobre todas as matrizes); um valor físico (surface/tap/...) = julga somente amostras dessa matriz. NULL deixou de existir: antes valia "qualquer matriz" por omissão e fazia lei de água potável julgar água bruta. Predicado único: limit_applies_to_matrix(s.matrix, ll.applies_to_matrix).';


--
-- Name: legislations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legislations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code public.citext NOT NULL,
    short_name text NOT NULL,
    name text NOT NULL,
    issuing_body text NOT NULL,
    jurisdiction text,
    document_reference text,
    publication_date date,
    effective_from date,
    effective_to date,
    source_url text,
    applies_to_matrix public.water_matrix,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legislations_check CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to >= effective_from)))
);


--
-- Name: COLUMN legislations.applies_to_matrix; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.legislations.applies_to_matrix IS 'Escopo declarado do instrumento como um todo (informativo; nullable — NULL = o instrumento não declara um escopo único). NÃO participa do predicado de julgamento: quem julga é legislation_limits.applies_to_matrix (PRO-13).';


--
-- Name: results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sample_id uuid NOT NULL,
    parameter_id uuid NOT NULL,
    replicate integer DEFAULT 1 NOT NULL,
    value_numeric numeric,
    value_text public.citext,
    unit text,
    detection_limit numeric,
    quantification_limit numeric,
    censored text,
    data_status text DEFAULT 'final'::text NOT NULL,
    method_code text,
    laboratory text,
    analyst text,
    measured_at timestamp with time zone,
    reported_at timestamp with time zone,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT results_censored_check CHECK ((censored = ANY (ARRAY['below_dl'::text, 'above_ul'::text, 'trace'::text, 'not_detected'::text]))),
    CONSTRAINT results_check CHECK (((value_numeric IS NOT NULL) OR (value_text IS NOT NULL))),
    CONSTRAINT results_check1 CHECK (((censored IS NULL) OR (value_numeric IS NOT NULL))),
    CONSTRAINT results_check2 CHECK (((reported_at IS NULL) OR (measured_at IS NULL) OR (reported_at >= measured_at))),
    CONSTRAINT results_data_status_check CHECK ((data_status = ANY (ARRAY['preliminary'::text, 'final'::text, 'amended'::text, 'rejected'::text]))),
    CONSTRAINT results_replicate_check CHECK ((replicate >= 1))
);


--
-- Name: samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.samples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sampling_point_id uuid NOT NULL,
    code public.citext NOT NULL,
    collected_at timestamp with time zone NOT NULL,
    matrix public.water_matrix DEFAULT 'surface'::text NOT NULL,
    depth_m numeric,
    temperature_c numeric(4,1),
    volume_l numeric,
    collected_by text,
    field_notes text,
    received_at timestamp with time zone,
    status text DEFAULT 'collected'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT samples_check CHECK (((received_at IS NULL) OR (received_at >= collected_at))),
    CONSTRAINT samples_depth_m_check CHECK (((depth_m IS NULL) OR (depth_m >= (0)::numeric))),
    CONSTRAINT samples_status_check CHECK ((status = ANY (ARRAY['collected'::text, 'in_transit'::text, 'received'::text, 'analysing'::text, 'reported'::text, 'void'::text]))),
    CONSTRAINT samples_temperature_c_check CHECK (((temperature_c IS NULL) OR ((temperature_c >= ('-20'::integer)::numeric) AND (temperature_c <= (100)::numeric)))),
    CONSTRAINT samples_volume_l_check CHECK (((volume_l IS NULL) OR (volume_l > (0)::numeric)))
);


--
-- Name: sampling_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sampling_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code public.citext NOT NULL,
    name text NOT NULL,
    description text,
    source_type text DEFAULT 'surface'::text NOT NULL,
    water_body text,
    region text,
    address text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    elevation_m numeric,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sampling_points_latitude_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))),
    CONSTRAINT sampling_points_longitude_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))),
    CONSTRAINT sampling_points_source_type_check CHECK ((source_type = ANY (ARRAY['surface'::text, 'ground'::text, 'treated_distribution'::text, 'tap'::text, 'effluent'::text, 'marine'::text, 'rainfall'::text, 'other'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: seed_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_history (
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: test_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_parameters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code public.citext NOT NULL,
    name text NOT NULL,
    synonyms text[] DEFAULT '{}'::text[] NOT NULL,
    category text DEFAULT 'chemical'::text NOT NULL,
    data_type text DEFAULT 'numeric'::text NOT NULL,
    unit text,
    method_reference text,
    method_code text,
    detection_limit numeric,
    reporting_limit numeric,
    ideal_range_lower numeric,
    ideal_range_upper numeric,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT test_parameters_category_check CHECK ((category = ANY (ARRAY['physical'::text, 'chemical'::text, 'microbiological'::text, 'radiological'::text, 'toxicological'::text, 'emerging'::text, 'other'::text]))),
    CONSTRAINT test_parameters_check CHECK (((data_type = 'numeric'::text) OR (unit IS NULL))),
    CONSTRAINT test_parameters_check1 CHECK (((detection_limit IS NULL) OR (reporting_limit IS NULL) OR (detection_limit <= reporting_limit))),
    CONSTRAINT test_parameters_check2 CHECK (((ideal_range_lower IS NULL) OR (ideal_range_upper IS NULL) OR (ideal_range_lower <= ideal_range_upper))),
    CONSTRAINT test_parameters_data_type_check CHECK ((data_type = ANY (ARRAY['numeric'::text, 'text'::text])))
);


--
-- Name: v_compliance_verdicts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_compliance_verdicts AS
 SELECT cv.id,
    cv.result_id,
    cv.legislation_limit_id,
    cv.verdict,
    cv.evaluated_value_numeric,
    cv.evaluated_value_text,
    cv.evaluated_unit,
    cv.reason,
    cv.rule_version,
    cv.evaluated_at,
    cv.evaluated_by,
    cv.superseded_at,
    r.sample_id,
    r.parameter_id,
    r.replicate,
    r.value_numeric AS result_value_numeric,
    r.value_text AS result_value_text,
    r.unit AS result_unit,
    s.code AS sample_code,
    s.collected_at,
    s.matrix,
    sp.id AS sampling_point_id,
    sp.code AS sampling_point_code,
    sp.name AS sampling_point_name,
    tp.code AS parameter_code,
    tp.name AS parameter_name,
    tp.category AS parameter_category,
    l.id AS legislation_id,
    l.code AS legislation_code,
    l.short_name AS legislation_short_name,
    l.issuing_body,
    ll.limit_kind,
    ll.limit_value,
    ll.limit_lower,
    ll.limit_upper,
    ll.limit_text,
    ll.unit AS limit_unit,
    ll.limit_tier,
    ll.applies_to_matrix,
    ll.citation
   FROM ((((((public.compliance_verdicts cv
     JOIN public.results r ON ((r.id = cv.result_id)))
     JOIN public.samples s ON ((s.id = r.sample_id)))
     JOIN public.sampling_points sp ON ((sp.id = s.sampling_point_id)))
     JOIN public.test_parameters tp ON ((tp.id = r.parameter_id)))
     JOIN public.legislation_limits ll ON ((ll.id = cv.legislation_limit_id)))
     JOIN public.legislations l ON ((l.id = ll.legislation_id)))
  WHERE (cv.superseded_at IS NULL);


--
-- Name: v_sample_compliance_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sample_compliance_summary AS
 SELECT sample_id,
    legislation_id,
    legislation_code,
    legislation_short_name,
    issuing_body,
    count(*) AS verdict_count,
    count(*) FILTER (WHERE (verdict = 'compliant'::text)) AS compliant_count,
    count(*) FILTER (WHERE (verdict = 'non_compliant'::text)) AS non_compliant_count,
    count(*) FILTER (WHERE (verdict = 'indeterminate'::text)) AS indeterminate_count,
        CASE
            WHEN (count(*) = 0) THEN 'not_evaluated'::text
            WHEN (count(*) FILTER (WHERE (verdict = 'non_compliant'::text)) > 0) THEN 'non_compliant'::text
            WHEN (count(*) FILTER (WHERE (verdict = 'indeterminate'::text)) > 0) THEN 'indeterminate'::text
            ELSE 'compliant'::text
        END AS sample_verdict,
    min(collected_at) AS collected_at,
    max(evaluated_at) AS last_evaluated_at
   FROM public.v_compliance_verdicts v
  GROUP BY sample_id, legislation_id, legislation_code, legislation_short_name, issuing_body;


--
-- Name: compliance_verdicts compliance_verdicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_verdicts
    ADD CONSTRAINT compliance_verdicts_pkey PRIMARY KEY (id);


--
-- Name: composite_limit_inputs composite_limit_inputs_composite_limit_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composite_limit_inputs
    ADD CONSTRAINT composite_limit_inputs_composite_limit_id_ordinal_key UNIQUE (composite_limit_id, ordinal);


--
-- Name: composite_limit_inputs composite_limit_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composite_limit_inputs
    ADD CONSTRAINT composite_limit_inputs_pkey PRIMARY KEY (composite_limit_id, parameter_id);


--
-- Name: composite_limits composite_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composite_limits
    ADD CONSTRAINT composite_limits_pkey PRIMARY KEY (id);


--
-- Name: laboratories laboratories_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.laboratories
    ADD CONSTRAINT laboratories_code_key UNIQUE (code);


--
-- Name: laboratories laboratories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.laboratories
    ADD CONSTRAINT laboratories_pkey PRIMARY KEY (id);


--
-- Name: legislation_limits legislation_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislation_limits
    ADD CONSTRAINT legislation_limits_pkey PRIMARY KEY (id);


--
-- Name: legislations legislations_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislations
    ADD CONSTRAINT legislations_code_key UNIQUE (code);


--
-- Name: legislations legislations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislations
    ADD CONSTRAINT legislations_pkey PRIMARY KEY (id);


--
-- Name: results results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_pkey PRIMARY KEY (id);


--
-- Name: results results_sample_id_parameter_id_replicate_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_sample_id_parameter_id_replicate_key UNIQUE (sample_id, parameter_id, replicate);


--
-- Name: samples samples_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_code_key UNIQUE (code);


--
-- Name: samples samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_pkey PRIMARY KEY (id);


--
-- Name: sampling_points sampling_points_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sampling_points
    ADD CONSTRAINT sampling_points_code_key UNIQUE (code);


--
-- Name: sampling_points sampling_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sampling_points
    ADD CONSTRAINT sampling_points_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: seed_history seed_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_history
    ADD CONSTRAINT seed_history_pkey PRIMARY KEY (name);


--
-- Name: test_parameters test_parameters_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_parameters
    ADD CONSTRAINT test_parameters_code_key UNIQUE (code);


--
-- Name: test_parameters test_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_parameters
    ADD CONSTRAINT test_parameters_pkey PRIMARY KEY (id);


--
-- Name: compliance_verdicts_current_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX compliance_verdicts_current_uq ON public.compliance_verdicts USING btree (result_id, legislation_limit_id) WHERE (superseded_at IS NULL);


--
-- Name: compliance_verdicts_limit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_verdicts_limit_idx ON public.compliance_verdicts USING btree (legislation_limit_id);


--
-- Name: compliance_verdicts_result_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_verdicts_result_idx ON public.compliance_verdicts USING btree (result_id);


--
-- Name: compliance_verdicts_verdict_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_verdicts_verdict_idx ON public.compliance_verdicts USING btree (verdict) WHERE (superseded_at IS NULL);


--
-- Name: composite_limit_inputs_parameter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX composite_limit_inputs_parameter_idx ON public.composite_limit_inputs USING btree (parameter_id);


--
-- Name: composite_limits_identity_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX composite_limits_identity_uq ON public.composite_limits USING btree (legislation_id, rule_code);


--
-- Name: composite_limits_legislation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX composite_limits_legislation_idx ON public.composite_limits USING btree (legislation_id);


--
-- Name: composite_limits_matrix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX composite_limits_matrix_idx ON public.composite_limits USING btree (applies_to_matrix);


--
-- Name: laboratories_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX laboratories_name_idx ON public.laboratories USING btree (name);


--
-- Name: legislation_limits_conversion_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legislation_limits_conversion_status_idx ON public.legislation_limits USING btree (conversion_status) WHERE (conversion_status <> 'exact'::text);


--
-- Name: legislation_limits_identity_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legislation_limits_identity_uq ON public.legislation_limits USING btree (legislation_id, parameter_id, COALESCE((applies_to_matrix)::text, '*'::text), limit_tier);


--
-- Name: legislation_limits_legislation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legislation_limits_legislation_idx ON public.legislation_limits USING btree (legislation_id);


--
-- Name: legislation_limits_parameter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legislation_limits_parameter_idx ON public.legislation_limits USING btree (parameter_id);


--
-- Name: results_data_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX results_data_status_idx ON public.results USING btree (data_status);


--
-- Name: results_parameter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX results_parameter_idx ON public.results USING btree (parameter_id);


--
-- Name: results_sample_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX results_sample_idx ON public.results USING btree (sample_id);


--
-- Name: samples_collected_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX samples_collected_at_idx ON public.samples USING btree (collected_at DESC);


--
-- Name: samples_matrix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX samples_matrix_idx ON public.samples USING btree (matrix);


--
-- Name: samples_point_collected_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX samples_point_collected_idx ON public.samples USING btree (sampling_point_id, collected_at DESC);


--
-- Name: sampling_points_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sampling_points_region_idx ON public.sampling_points USING btree (region);


--
-- Name: test_parameters_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX test_parameters_category_idx ON public.test_parameters USING btree (category, sort_order);


--
-- Name: composite_limit_inputs composite_limit_inputs_require_two; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER composite_limit_inputs_require_two AFTER INSERT OR DELETE OR UPDATE ON public.composite_limit_inputs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.composite_limit_inputs_validate();


--
-- Name: composite_limit_inputs composite_limit_inputs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER composite_limit_inputs_set_updated_at BEFORE UPDATE ON public.composite_limit_inputs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: composite_limits composite_limits_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER composite_limits_set_updated_at BEFORE UPDATE ON public.composite_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: laboratories laboratories_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER laboratories_set_updated_at BEFORE UPDATE ON public.laboratories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: legislation_limits legislation_limits_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legislation_limits_set_updated_at BEFORE UPDATE ON public.legislation_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: legislations legislations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER legislations_set_updated_at BEFORE UPDATE ON public.legislations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: results results_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER results_set_updated_at BEFORE UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: samples samples_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER samples_set_updated_at BEFORE UPDATE ON public.samples FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sampling_points sampling_points_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sampling_points_set_updated_at BEFORE UPDATE ON public.sampling_points FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: test_parameters test_parameters_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER test_parameters_set_updated_at BEFORE UPDATE ON public.test_parameters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: compliance_verdicts compliance_verdicts_legislation_limit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_verdicts
    ADD CONSTRAINT compliance_verdicts_legislation_limit_id_fkey FOREIGN KEY (legislation_limit_id) REFERENCES public.legislation_limits(id) ON DELETE RESTRICT;


--
-- Name: compliance_verdicts compliance_verdicts_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_verdicts
    ADD CONSTRAINT compliance_verdicts_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.results(id) ON DELETE CASCADE;


--
-- Name: composite_limit_inputs composite_limit_inputs_composite_limit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composite_limit_inputs
    ADD CONSTRAINT composite_limit_inputs_composite_limit_id_fkey FOREIGN KEY (composite_limit_id) REFERENCES public.composite_limits(id) ON DELETE CASCADE;


--
-- Name: composite_limit_inputs composite_limit_inputs_parameter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composite_limit_inputs
    ADD CONSTRAINT composite_limit_inputs_parameter_id_fkey FOREIGN KEY (parameter_id) REFERENCES public.test_parameters(id) ON DELETE RESTRICT;


--
-- Name: composite_limits composite_limits_legislation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composite_limits
    ADD CONSTRAINT composite_limits_legislation_id_fkey FOREIGN KEY (legislation_id) REFERENCES public.legislations(id) ON DELETE RESTRICT;


--
-- Name: legislation_limits legislation_limits_legislation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislation_limits
    ADD CONSTRAINT legislation_limits_legislation_id_fkey FOREIGN KEY (legislation_id) REFERENCES public.legislations(id) ON DELETE RESTRICT;


--
-- Name: legislation_limits legislation_limits_parameter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legislation_limits
    ADD CONSTRAINT legislation_limits_parameter_id_fkey FOREIGN KEY (parameter_id) REFERENCES public.test_parameters(id) ON DELETE RESTRICT;


--
-- Name: results results_parameter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_parameter_id_fkey FOREIGN KEY (parameter_id) REFERENCES public.test_parameters(id) ON DELETE RESTRICT;


--
-- Name: results results_sample_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.samples(id) ON DELETE CASCADE;


--
-- Name: samples samples_sampling_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_sampling_point_id_fkey FOREIGN KEY (sampling_point_id) REFERENCES public.sampling_points(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict sn5KaHvhhpjmukLMksc4xnpMQBgv6dsi8AW82IFGcMuUEzZ8rzQO4Ttu8CtWcbD

