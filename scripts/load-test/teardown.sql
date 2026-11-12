-- Removes everything the load test created. Safe to re-run.
BEGIN;
CREATE TEMP TABLE lt_users ON COMMIT DROP AS
  SELECT id, auth_id FROM public.users
  WHERE email LIKE '%@loadtest.invalid' AND metadata->>'load_test' = 'lt_2026_11';
SELECT count(*) AS load_test_users FROM lt_users;

DELETE FROM public.behavioral_events WHERE user_id IN (SELECT id FROM lt_users);
DELETE FROM public.behavioral_events WHERE event_type = 'load_test';
DELETE FROM public.login_attempts WHERE email LIKE '%@loadtest.invalid';
DELETE FROM public.consent_records WHERE user_id IN (SELECT id FROM lt_users);
DELETE FROM public.user_profiles WHERE user_id IN (SELECT id FROM lt_users);
DELETE FROM public.users WHERE id IN (SELECT id FROM lt_users);
DELETE FROM auth.users WHERE email LIKE '%@loadtest.invalid';

SELECT (SELECT count(*) FROM public.users WHERE email LIKE '%@loadtest.invalid') AS users_left,
       (SELECT count(*) FROM auth.users WHERE email LIKE '%@loadtest.invalid') AS auth_left;
COMMIT;
