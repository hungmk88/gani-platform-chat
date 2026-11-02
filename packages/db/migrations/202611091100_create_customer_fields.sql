-- rollback: compensating migration drops tables public.customer_field_values and public.customer_field_defs; only before a person sets a value.
-- The custom fields of a company's customers (J1, T-5/U46, U36, N191; Tag 2a-ii, CEO 02/11/2026): the fields of the company, shared by
-- every workspace, so RLS by organisation only, and the value each customer has for a field. A field ends with deleted_at (DELETE of a
-- field with values is 409, the API only hides it), never a DELETE; app_role has no DELETE anywhere (spec RLS M01 §7 case 11, kept by
-- the CEO 02/11/2026): clearing a value sets it to NULL. At most 50 live fields a company: the store counts them under a lock.
-- Values are personal data: support_role reads which customer has a value for which field, never the value (as tickets.title). A
-- sensitive field's values are encrypted by Tag 2b (value_enc, key_version); until then the store refuses them.

CREATE TABLE public.customer_field_defs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  options text[] NOT NULL DEFAULT '{}',
  required boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_field_defs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customer_field_defs_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT customer_field_defs_name_check CHECK (
    btrim(name) = name AND name <> '' AND char_length(name) <= 100 AND name = normalize(name, NFC)
  ),
  CONSTRAINT customer_field_defs_type_check
    CHECK (type IN ('text', 'number', 'date', 'select', 'multiselect', 'phone', 'email')),
  -- select and multiselect have 2 to 50 choices (U46), every other type none; each choice is checked by the API.
  CONSTRAINT customer_field_defs_options_check CHECK (
    CASE WHEN type IN ('select', 'multiselect') THEN cardinality(options) BETWEEN 2 AND 50
    ELSE cardinality(options) = 0 END
  ),
  CONSTRAINT customer_field_defs_position_check CHECK (position >= 0)
);

-- The list of fields by position.
CREATE INDEX customer_field_defs_org_position_idx ON public.customer_field_defs (org_id, position) WHERE deleted_at IS NULL;

CREATE TABLE public.customer_field_values (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  field_id uuid NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_field_values_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customer_field_values_customer_fk FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_field_values_field_fk FOREIGN KEY (org_id, field_id)
    REFERENCES public.customer_field_defs (org_id, id) ON DELETE RESTRICT,
  -- One row per customer and field: setting a value again updates it, clearing it sets NULL.
  CONSTRAINT customer_field_values_key UNIQUE (org_id, customer_id, field_id),
  -- A value is a string, a number or a list of strings (the API checks it against the field's type and choices).
  CONSTRAINT customer_field_values_value_check CHECK (value IS NULL OR jsonb_typeof(value) IN ('string', 'number', 'array'))
);

-- hasData of a field (type and sensitive no longer change, DELETE is 409) and the values of a field.
CREATE INDEX customer_field_values_field_idx ON public.customer_field_values (org_id, field_id) WHERE value IS NOT NULL;

ALTER TABLE public.customer_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_field_defs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_field_values FORCE ROW LEVEL SECURITY;

CREATE POLICY customer_field_defs_app ON public.customer_field_defs FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customer_field_defs_support ON public.customer_field_defs FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY customer_field_values_app ON public.customer_field_values FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customer_field_values_support ON public.customer_field_values FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- id, org_id and what a value belongs to never change; no DELETE (case 11).
GRANT SELECT, INSERT ON public.customer_field_defs TO app_role;
GRANT UPDATE (name, type, options, required, sensitive, hidden, position, deleted_at, updated_at)
  ON public.customer_field_defs TO app_role;
GRANT SELECT, INSERT ON public.customer_field_values TO app_role;
GRANT UPDATE (value, updated_at) ON public.customer_field_values TO app_role;
GRANT SELECT ON public.customer_field_defs TO support_role;
GRANT SELECT (id, org_id, customer_id, field_id, created_at, updated_at) ON public.customer_field_values TO support_role;
