-- Crew audience approval (2026-11-19).
--
-- Anyone who has a player's invite code can join that player's crew
-- (minion_links, 046), and an invite link can be passed on. Being in a crew
-- now also decides who is in an adult's "My Crew" privacy audience
-- (src/lib/social/social-tiers.ts), so joining alone must not be enough:
--
--   audience_approved_at   when the RECRUITER let this crew member into their
--                          "My Crew" audience. Null means not approved: the
--                          member is in the crew (and the points still flow)
--                          but sees nothing extra of the recruiter's.
--
-- The other direction needs no approval: a member chose their recruiter by
-- using that recruiter's code, so the recruiter is in the member's audience.
--
-- Only the API writes this column, with the service role
-- (PUT /api/v1/social/referrals/audience); no policy changes. No row is
-- rewritten: every existing link starts unapproved.
-- Apply BEFORE deploying the code that reads the column.
-- Safe to run more than once.

alter table public.minion_links
  add column if not exists audience_approved_at timestamptz;

comment on column public.minion_links.audience_approved_at is
  'When the recruiter let this crew member into their "My Crew" privacy audience. Null = not approved.';
