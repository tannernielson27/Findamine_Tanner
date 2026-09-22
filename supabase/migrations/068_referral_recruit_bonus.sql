-- 068: one-time recruit bonus for the referral economy.
--
-- A recruiter earns a flat bonus when a minion completes their first find,
-- paid through the same disclosure gate as the ongoing share. The timestamp is
-- claimed with a conditional UPDATE (... WHERE first_score_bonus_at IS NULL),
-- so concurrent finds can never pay it twice. It is stamped whether the bonus
-- was paid or forfeited: the bonus is offered once.

alter table public.minion_links
  add column if not exists first_score_bonus_at timestamptz;

comment on column public.minion_links.first_score_bonus_at is
  'When the one-time recruit bonus for this minion''s first find was claimed (paid or forfeited).';
