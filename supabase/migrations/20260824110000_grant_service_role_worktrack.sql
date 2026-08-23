-- The worktrack schema was only ever granted to anon/authenticated (see
-- 20260821130000_create_worktrack_schema.sql) — service_role was never granted USAGE, so the
-- account-recovery Edge Function's admin client has been unable to read or write ANY worktrack
-- table since it was created (every call silently failed with "permission denied for schema
-- worktrack" and was swallowed into a generic "not found" response). This is why recovery
-- lookups/resets never actually worked end-to-end for a real account.
GRANT USAGE ON SCHEMA worktrack TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA worktrack TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA worktrack GRANT ALL ON TABLES TO service_role;
