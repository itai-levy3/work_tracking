-- Brings worktrack.settings / worktrack.work_hours up to date with everything added to
-- src/lib/localData.ts's UserSettings / WorkHour since the schema was first created — statutory
-- payroll, pension, training fund, food-card tracking, salary-cap mode, and multi-segment days.
-- All additive (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) — safe to run against the existing
-- worktrack.settings / worktrack.work_hours tables with no data loss.

-- ============================================================================
-- worktrack.settings — new columns
-- ============================================================================
ALTER TABLE worktrack.settings
  ADD COLUMN IF NOT EXISTS salary_mode TEXT NOT NULL DEFAULT 'hourly'
    CHECK (salary_mode IN ('hourly', 'cap')),
  ADD COLUMN IF NOT EXISTS salary_cap_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS statutory_deduction_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (statutory_deduction_mode IN ('automatic', 'manual')),
  ADD COLUMN IF NOT EXISTS tax_credit_points NUMERIC(4,2) NOT NULL DEFAULT 2.25,
  ADD COLUMN IF NOT EXISTS manual_income_tax NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_national_insurance NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_health_insurance NUMERIC(10,2) NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS pension_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pension_employee_rate NUMERIC(4,2) NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS pension_base_mode TEXT NOT NULL DEFAULT 'full'
    CHECK (pension_base_mode IN ('full', 'custom')),
  ADD COLUMN IF NOT EXISTS pension_custom_base NUMERIC(10,2) NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS training_fund_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS training_fund_employee_rate NUMERIC(4,2) NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS training_fund_base_mode TEXT NOT NULL DEFAULT 'full'
    CHECK (training_fund_base_mode IN ('full', 'custom')),
  ADD COLUMN IF NOT EXISTS training_fund_custom_base NUMERIC(10,2) NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS food_card_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_card_has_card BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS food_card_monthly_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_card_daily_cap NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ============================================================================
-- worktrack.work_hours — multi-segment days (clock out and back in on the same day)
-- ============================================================================
ALTER TABLE worktrack.work_hours
  ADD COLUMN IF NOT EXISTS segments JSONB;
-- Each element: { "start": "HH:MM", "end": "HH:MM"|null, "evening": boolean|undefined }

-- ============================================================================
-- worktrack.food_entries — one row per logged meal expense (src/lib/localData.ts FoodEntry)
-- ============================================================================
CREATE TABLE IF NOT EXISTS worktrack.food_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME,
  card_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  personal_top_up NUMERIC(10,2),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS food_entries_user_date_idx
  ON worktrack.food_entries (user_id, date);

ALTER TABLE worktrack.food_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_entries_select_own" ON worktrack.food_entries;
CREATE POLICY "food_entries_select_own" ON worktrack.food_entries
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "food_entries_insert_own" ON worktrack.food_entries;
CREATE POLICY "food_entries_insert_own" ON worktrack.food_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "food_entries_delete_own" ON worktrack.food_entries;
CREATE POLICY "food_entries_delete_own" ON worktrack.food_entries
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- worktrack.pdf_archive — the last-3-months month-end payslip PDFs (src/lib/localData.ts
-- PdfArchiveEntry). Stores the PDF as base64 text — simplest to keep in the same DB as
-- everything else without wiring up Supabase Storage for a handful of small files.
-- ============================================================================
CREATE TABLE IF NOT EXISTS worktrack.pdf_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL, -- 0-indexed, matches JS Date
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_url TEXT NOT NULL,
  UNIQUE (user_id, year, month)
);

ALTER TABLE worktrack.pdf_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdf_archive_select_own" ON worktrack.pdf_archive;
CREATE POLICY "pdf_archive_select_own" ON worktrack.pdf_archive
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "pdf_archive_insert_own" ON worktrack.pdf_archive;
CREATE POLICY "pdf_archive_insert_own" ON worktrack.pdf_archive
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "pdf_archive_update_own" ON worktrack.pdf_archive;
CREATE POLICY "pdf_archive_update_own" ON worktrack.pdf_archive
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "pdf_archive_delete_own" ON worktrack.pdf_archive;
CREATE POLICY "pdf_archive_delete_own" ON worktrack.pdf_archive
  FOR DELETE USING (auth.uid() = user_id);

GRANT ALL ON ALL TABLES IN SCHEMA worktrack TO anon, authenticated;
