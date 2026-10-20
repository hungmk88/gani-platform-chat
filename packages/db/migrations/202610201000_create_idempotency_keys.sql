-- rollback: compensating migration drops table public.idempotency_keys; a POST sent again is then done twice (Brief P9, N134).
-- idempotency_keys: what makes a POST with an Idempotency-Key safe to send again (Brief P9: "server lưu 24 giờ; gửi lại trả kết quả cũ").
-- One row per (organisation, person, key): the first request writes it `in_progress`, its answer turns it `done` with the status and
-- body to give back; the same key with another request is refused. The scope is the person, not only the organisation, so one user
-- cannot replay what another sent. A key older than 24 hours, a failed attempt (5xx, nothing stored) and an attempt stuck
-- `in_progress` (its process died) can be used again: the row is reset, never deleted (app_role has no DELETE, N134).
-- The body kept is the answer the API gave, which may name a conversation: RLS by organisation, and support_role does not read it.

CREATE TABLE public.idempotency_keys (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (org_id, user_id, key),
  CONSTRAINT idempotency_keys_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT idempotency_keys_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT,
  -- Printable ASCII, no space: a header value a client generates (a UUID, typically), never free text.
  CONSTRAINT idempotency_keys_key_check CHECK (key ~ '^[!-~]{1,255}$'),
  CONSTRAINT idempotency_keys_method_check CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT idempotency_keys_path_check CHECK (path LIKE '/%' AND char_length(path) <= 512),
  CONSTRAINT idempotency_keys_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_keys_status_check CHECK (status IN ('in_progress', 'done', 'failed')),
  -- An answer is kept only when it is done, and only a 2xx or a 4xx: a 5xx is not an answer to give back (the client tries again).
  CONSTRAINT idempotency_keys_response_check CHECK (
    (status = 'done') = (response_status IS NOT NULL)
    AND (response_status IS NULL OR response_status BETWEEN 200 AND 499)
  )
);

-- What a later purge of the keys older than 24 hours scans.
CREATE INDEX idempotency_keys_created_idx ON public.idempotency_keys (created_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_app ON public.idempotency_keys FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY idempotency_keys_support ON public.idempotency_keys FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- The identity of a row (org_id, user_id, key) never changes; everything else is what a reset or an answer writes.
GRANT SELECT, INSERT ON public.idempotency_keys TO app_role;
GRANT UPDATE (method, path, request_hash, status, response_status, response_body, created_at, updated_at)
  ON public.idempotency_keys TO app_role;
-- Not response_body: what support needs is whether a key was used, not the answer it got.
GRANT SELECT (org_id, user_id, key, method, path, status, response_status, created_at, updated_at)
  ON public.idempotency_keys TO support_role;
