-- Adds lockout tracking to worktrack.recovery_credentials for the sequential
-- security-question challenge (see supabase/functions/account-recovery/index.ts).
-- Only ever written by that Edge Function (service_role) — no RLS policy changes needed,
-- the existing SELECT/INSERT/UPDATE policies scoped to auth.uid() = user_id already cover it.

alter table worktrack.recovery_credentials
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_at timestamptz;
