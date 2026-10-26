-- rollback: compensating migration drops constraint workspaces_contact_phone_check and column contact_phone, and revokes UPDATE on it; only before templates use {{company_phone}} (N163).
-- The number customers call for a workspace (a B2B hotline is not the B2C one): what {{company_phone}} of a quick reply becomes (C7,
-- N163). NULL until an Owner or an Admin sets it; the Inbox then asks the agent to fill the variable. A company line, written by people
-- of the company: digits, spaces, dots, dashes, an optional leading +.

ALTER TABLE public.workspaces
  ADD COLUMN contact_phone text,
  ADD CONSTRAINT workspaces_contact_phone_check CHECK (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9][0-9 .-]{5,19}$');

GRANT UPDATE (contact_phone) ON public.workspaces TO app_role;
