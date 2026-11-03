-- rollback: compensating migration drops the CHECK bot_flows_description_check and the column description, and revokes UPDATE on it; only before flows use it (U77 (i)).
-- The description of a bot flow (U77 (i), CEO 03/11/2026: Tầng 2): free text for the builders, at most 500 characters like a team's,
-- never blank; NULL is none. Not searched, so not NFC-checked (packages/db/CLAUDE.md). bot_flows is small: no rewrite, the column is
-- nullable without a default.

ALTER TABLE public.bot_flows
  ADD COLUMN description text,
  ADD CONSTRAINT bot_flows_description_check CHECK (
    description IS NULL OR (btrim(description) <> '' AND char_length(description) <= 500)
  );

-- Added to the columns app_role may UPDATE (name, status, version, deleted_at, updated_at); support_role reads the whole table already.
GRANT UPDATE (description) ON public.bot_flows TO app_role;
