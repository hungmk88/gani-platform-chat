-- rollback: compensating migration drops the columns value_enc and key_version of public.customer_field_values (and their CHECKs and
-- index); only before a person sets the value of a sensitive field.
-- The value of a sensitive custom field, encrypted (Tag 2b, T-5/U46, N191; CEO 02/11/2026 answers 3 and 4): value_enc is made by the
-- SecretBox of @gani/channels (AES-256-GCM, nonce ‖ tag ‖ ciphertext) with the same keys and key_version as the channel secrets, so one
-- rotation covers both (#461); the additional data is the row id and 'customer_field_values.value_enc', so a ciphertext copied to another
-- row or column does not decrypt. The plaintext is the JSON of the value (a string, a number or a list), checked by the store against
-- the field before it is encrypted: the database never sees it. Which field is sensitive is the store's rule (3b): a sensitive field
-- writes value_enc, never value, and the other way round.

ALTER TABLE public.customer_field_values
  ADD COLUMN value_enc bytea,
  ADD COLUMN key_version integer,
  -- A row holds a plain value or an encrypted one, never both; a cleared value has neither. key_version says which key, so it is set
  -- exactly when value_enc is.
  ADD CONSTRAINT customer_field_values_one_value_check CHECK (value IS NULL OR value_enc IS NULL),
  ADD CONSTRAINT customer_field_values_key_version_check
    CHECK ((value_enc IS NULL AND key_version IS NULL) OR (value_enc IS NOT NULL AND key_version IS NOT NULL AND key_version >= 1));

-- hasData of a sensitive field, next to customer_field_values_field_idx for the plain values.
CREATE INDEX customer_field_values_field_enc_idx ON public.customer_field_values (org_id, field_id) WHERE value_enc IS NOT NULL;

-- app_role sets and clears an encrypted value, and re-encrypts it with a new key. support_role reads key_version (as on
-- channel_accounts), never value_enc: its SELECT on this table lists columns, so value_enc stays hidden without a REVOKE.
GRANT UPDATE (value_enc, key_version) ON public.customer_field_values TO app_role;
GRANT SELECT (key_version) ON public.customer_field_values TO support_role;
