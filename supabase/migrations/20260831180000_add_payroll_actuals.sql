-- Actual-vs-estimated net pay reconciliation per month (see src/lib/localData.ts PayrollActual).
create table if not exists worktrack.payroll_actuals (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null, -- 0-indexed, matches JS Date#getMonth()
  actual_net numeric not null,
  estimated_net numeric not null,
  reason_id text,
  note text,
  ai_analysis text,
  override_field text,
  override_value numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, year, month)
);

alter table worktrack.payroll_actuals enable row level security;

create policy "select own payroll_actuals" on worktrack.payroll_actuals
  for select using (auth.uid() = user_id);
create policy "insert own payroll_actuals" on worktrack.payroll_actuals
  for insert with check (auth.uid() = user_id);
create policy "update own payroll_actuals" on worktrack.payroll_actuals
  for update using (auth.uid() = user_id);
create policy "delete own payroll_actuals" on worktrack.payroll_actuals
  for delete using (auth.uid() = user_id);

GRANT ALL ON worktrack.payroll_actuals TO authenticated;
GRANT ALL ON worktrack.payroll_actuals TO service_role;
