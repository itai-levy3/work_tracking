-- Creates a DEDICATED Postgres schema for WorkTrack ("worktrack"), separate from
-- "public" where the other apps in this Supabase project (events, goals, tasks, ...)
-- live. This is real namespace isolation, not just a table-name prefix.

CREATE SCHEMA IF NOT EXISTS worktrack;

-- ============================================================================
-- worktrack.settings — one row per user, mirrors src/lib/localData.ts UserSettings
-- ============================================================================
CREATE TABLE IF NOT EXISTS worktrack.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  work_days JSONB NOT NULL DEFAULT
    '{"sunday":false,"monday":true,"tuesday":true,"wednesday":true,"thursday":true,"friday":true,"saturday":false}'::jsonb,
  hours_per_day JSONB NOT NULL DEFAULT
    '{"sunday":0,"monday":8,"tuesday":8,"wednesday":8,"thursday":8,"friday":8,"saturday":0}'::jsonb,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,

  evening_shift_enabled BOOLEAN NOT NULL DEFAULT false,
  evening_shift_hours NUMERIC(4,2) NOT NULL DEFAULT 7,

  overtime_calc_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Up to 5 entries: [{ "rateType": "percent"|"fixed", "rateValue": number }, ...]
  -- index 0 = 1st hour of overtime, index 1 = 2nd hour, etc.
  overtime_tiers JSONB NOT NULL DEFAULT
    '[{"rateType":"percent","rateValue":125},{"rateType":"percent","rateValue":150}]'::jsonb,
  overtime_round_hours BOOLEAN NOT NULL DEFAULT false,

  -- Each: [{ "label": string, "amount": number }, ...]
  fixed_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  deductions JSONB NOT NULL DEFAULT '[]'::jsonb,

  annual_vacation_days NUMERIC(5,2) NOT NULL DEFAULT 12,
  annual_sick_days NUMERIC(5,2) NOT NULL DEFAULT 18,
  vacation_accrual_method TEXT NOT NULL DEFAULT 'monthly'
    CHECK (vacation_accrual_method IN ('lump_sum', 'monthly')),
  sick_accrual_method TEXT NOT NULL DEFAULT 'monthly'
    CHECK (sick_accrual_method IN ('lump_sum', 'monthly')),
  employment_start_date DATE,
  min_vacation_days_required NUMERIC(5,2) NOT NULL DEFAULT 10,

  first_name TEXT NOT NULL DEFAULT 'WorkTrack',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- worktrack.work_hours — one row per user per calendar day
-- ============================================================================
CREATE TABLE IF NOT EXISTS worktrack.work_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
  start_time TIME,
  end_time TIME,

  status TEXT NOT NULL DEFAULT 'worked'
    CHECK (status IN ('worked', 'vacation', 'sick', 'holiday', 'off')),
  fraction TEXT CHECK (fraction IS NULL OR fraction IN ('full', 'three_quarters', 'half')),
  paid BOOLEAN,
  deficit_covered_by TEXT CHECK (deficit_covered_by IS NULL OR deficit_covered_by IN ('vacation', 'sick')),
  evening BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  one_time_planned_hours NUMERIC(5,2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS work_hours_user_date_idx
  ON worktrack.work_hours (user_id, date);

-- ============================================================================
-- Row Level Security — every row scoped to its owner
-- ============================================================================
ALTER TABLE worktrack.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE worktrack.work_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_own" ON worktrack.settings;
CREATE POLICY "settings_select_own" ON worktrack.settings
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "settings_insert_own" ON worktrack.settings;
CREATE POLICY "settings_insert_own" ON worktrack.settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "settings_update_own" ON worktrack.settings;
CREATE POLICY "settings_update_own" ON worktrack.settings
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "settings_delete_own" ON worktrack.settings;
CREATE POLICY "settings_delete_own" ON worktrack.settings
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "work_hours_select_own" ON worktrack.work_hours;
CREATE POLICY "work_hours_select_own" ON worktrack.work_hours
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "work_hours_insert_own" ON worktrack.work_hours;
CREATE POLICY "work_hours_insert_own" ON worktrack.work_hours
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "work_hours_update_own" ON worktrack.work_hours;
CREATE POLICY "work_hours_update_own" ON worktrack.work_hours
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "work_hours_delete_own" ON worktrack.work_hours;
CREATE POLICY "work_hours_delete_own" ON worktrack.work_hours
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- Keep updated_at current on every UPDATE
-- ============================================================================
CREATE OR REPLACE FUNCTION worktrack.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = worktrack;

DROP TRIGGER IF EXISTS settings_set_updated_at ON worktrack.settings;
CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON worktrack.settings
  FOR EACH ROW EXECUTE FUNCTION worktrack.set_updated_at();

DROP TRIGGER IF EXISTS work_hours_set_updated_at ON worktrack.work_hours;
CREATE TRIGGER work_hours_set_updated_at
  BEFORE UPDATE ON worktrack.work_hours
  FOR EACH ROW EXECUTE FUNCTION worktrack.set_updated_at();

-- ============================================================================
-- Let the API layer (PostgREST / supabase-js) reach this schema at all.
-- Without this, "exposing" the schema in the dashboard has nothing to grant on.
-- ============================================================================
GRANT USAGE ON SCHEMA worktrack TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA worktrack TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA worktrack GRANT ALL ON TABLES TO anon, authenticated;

-- Note: no auto-provisioning trigger on auth.users here (on purpose — this project
-- already has its own user-signup wiring for other apps in "public"). The WorkTrack
-- app should upsert a default worktrack.settings row for the current user on first login.
