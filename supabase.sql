-- Postfin on Supabase: run this once in the SQL Editor.
--
-- The app creates and migrates its own tables on boot, so this file is not
-- a schema definition - it is the hardening step Supabase specifically
-- needs, plus an index that pays off once you have real post history.
--
-- Why it matters: Supabase publishes every table in the `public` schema
-- through PostgREST, and grants the `anon` and `authenticated` roles access
-- to them. Postfin's `accounts` table stores live OAuth access tokens and
-- refresh tokens for every connected social account. Without this, anyone
-- holding your project's anon key - which ships in client-side code by
-- design - could read them.
--
-- Enabling RLS with no policies denies those roles everything. Postfin
-- connects as the table owner, which bypasses RLS, so the app is unaffected.
--
-- Safe to re-run.

-- 1. Deny the API roles access to Postfin's tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'users', 'ugc_jobs', 'ugc_posts', 'post_metrics', 'account_metrics'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- Belt and braces: drop the blanket grants Supabase applies to new
      -- tables, so the tables are unreachable even if RLS is turned off later.
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- 2. The metrics tables are the ones that grow without bound - one row per
-- post per collection run. These indexes keep the analytics queries, which
-- look up each post's most recent snapshot, from scanning the whole table.
CREATE INDEX IF NOT EXISTS post_metrics_latest_idx
  ON public.post_metrics (post_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS account_metrics_latest_idx
  ON public.account_metrics (account_id, collected_at DESC);

-- 3. Posts are filtered by publish time on every dashboard load.
CREATE INDEX IF NOT EXISTS ugc_posts_posted_at_idx
  ON public.ugc_posts (posted_at) WHERE status = 'done';

-- 4. The calendar reads a date window on every view.
CREATE INDEX IF NOT EXISTS ugc_jobs_slot_idx
  ON public.ugc_jobs (COALESCE(scheduled_at, created_at));

-- Confirm what was hardened.
SELECT tablename,
       rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('accounts', 'users', 'ugc_jobs', 'ugc_posts', 'post_metrics', 'account_metrics')
ORDER BY tablename;
