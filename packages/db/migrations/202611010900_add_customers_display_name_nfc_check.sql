-- rollback: compensating migration drops constraint customers_display_name_nfc_check only; the names stay in NFC (turning them back into NFD would only bring the bug back).
-- The names of customers in NFC (N165, U48, U30): a name typed in NFD (PATCH /v1/customers/{id} stored it as sent) never matched a search
-- typed in NFC, in the Khách hàng list and the Inbox alike. Fixed where the name is written (updateCustomer normalises it), so a search
-- compares the column as stored, with no normalize() per row (+80 % on a full scan, measured 28/10). The inbound worker writes no name
-- (the Zalo webhook carries none), so PATCH is the only path; the CHECK below fails loudly on any other that would write NFD.
-- display_name IS NULL is allowed (customer without name yet): the CHECK only constrains non-null values.
-- updated_at is left as it is: no trigger on customers sets it (only updateCustomer does), and this is not an edit by a person.

UPDATE public.customers SET display_name = normalize(display_name, NFC)
  WHERE display_name <> normalize(display_name, NFC);

ALTER TABLE public.customers
  ADD CONSTRAINT customers_display_name_nfc_check CHECK (display_name = normalize(display_name, NFC));
