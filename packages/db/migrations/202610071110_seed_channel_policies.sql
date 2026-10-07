-- rollback: compensating migration deletes the two rows by id (01a116b2-f52b-7632-9d7e-7e4c11f4d2b8 and 01a116b2-f52c-7511-883a-7060e793adf3); only acceptable before the code reads them.
-- Starting values of channel_policies for Zalo OA (channel-policy-spec §1, N100/N102). TEMPORARY: taken from the official announcement of
-- Zalo OA (posted 15/01/2024, in force from 20/06/2023), not from the Brief, and waiting for the owner to confirm them (C4). That is
-- why both rows carry the note below. Different official values are a new row with a new effective_from, never an edit of these rows.
-- Reference data, not test data: it runs wherever the migrations run. No row for broadcast: nothing needs a number there yet.

INSERT INTO public.channel_policies
  (id, channel_type, message_class, effective_from, free_window_seconds, free_message_quota, unit_price_vnd,
   outside_window_allowed, source_url, source_date, note)
VALUES
  -- Advisory message: 48 hours from the last message of the user, 8 free messages, 55 VND for each one outside the window or the quota.
  ('01a116b2-f52b-7632-9d7e-7e4c11f4d2b8', 'zalo_oa', 'advisory', '2023-06-20 00:00:00+07', 172800, 8, 55,
   true, 'https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099', '2024-01-15',
   'tạm, chờ xác nhận'),
  -- Transaction message: 165 VND each; no free window or quota applies.
  ('01a116b2-f52c-7511-883a-7060e793adf3', 'zalo_oa', 'transaction', '2023-06-20 00:00:00+07', NULL, NULL, 165,
   true, 'https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099', '2024-01-15',
   'tạm, chờ xác nhận');
