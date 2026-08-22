-- PIN + security-question account recovery, replacing email-link password reset. The actual
-- password change for an unauthenticated user can only happen through the "account-recovery"
-- Edge Function (which alone holds the service_role key) — this table is never readable by the
-- anon role; the Edge Function bypasses RLS via its own admin client, and a logged-in user can
-- only ever read/write their OWN row (to set up or change their own PIN/questions).

CREATE TABLE IF NOT EXISTS worktrack.recovery_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  -- Exactly 3 entries: [{ "questionId": "pet", "hash": "..." }, ...]
  security_answers JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE worktrack.recovery_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recovery_select_own" ON worktrack.recovery_credentials;
CREATE POLICY "recovery_select_own" ON worktrack.recovery_credentials
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "recovery_insert_own" ON worktrack.recovery_credentials;
CREATE POLICY "recovery_insert_own" ON worktrack.recovery_credentials
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "recovery_update_own" ON worktrack.recovery_credentials;
CREATE POLICY "recovery_update_own" ON worktrack.recovery_credentials
  FOR UPDATE USING (auth.uid() = user_id);

-- Intentionally no policy for anon and no DELETE policy for anyone — recovery credentials are
-- only ever created or replaced (upsert), never deleted by the app itself.

CREATE OR REPLACE FUNCTION worktrack.set_recovery_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = worktrack;

DROP TRIGGER IF EXISTS recovery_credentials_set_updated_at ON worktrack.recovery_credentials;
CREATE TRIGGER recovery_credentials_set_updated_at
  BEFORE UPDATE ON worktrack.recovery_credentials
  FOR EACH ROW EXECUTE FUNCTION worktrack.set_recovery_updated_at();

GRANT ALL ON worktrack.recovery_credentials TO authenticated;
