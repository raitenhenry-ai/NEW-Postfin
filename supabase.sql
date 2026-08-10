-- Postfin on Supabase: run this once in the SQL Editor.
--
-- The app creates and migrates its own tables on boot, so this file is not
-- a schema definition - it is the hardening step Supabase specifically
-- needs. Nothing else here is required; Neon and other Postgres hosts do
-- not need this file at all.
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
    'accounts', 'users', 'ugc_jobs', 'ugc_posts', 'post_metrics', 'account_metrics', 'products'
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

-- Indexes are applied by the app on boot, so there is nothing else to run.

-- Confirm what was hardened.
SELECT tablename,
       rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('accounts', 'users', 'ugc_jobs', 'ugc_posts', 'post_metrics', 'account_metrics', 'products')
ORDER BY tablename;
