-- rollback: compensating migration drops index conversations_customer_idx CONCURRENTLY; the conversations of a customer are then found by a scan.
-- migrate:no-transaction
-- The conversations of a customer (J6 "một hồ sơ gom hội thoại", N165). Built CONCURRENTLY (review DB-03): conversations is written
-- by every message.
CREATE INDEX CONCURRENTLY conversations_customer_idx
  ON public.conversations (org_id, customer_id)
  WHERE customer_id IS NOT NULL;
