alter table worktrack.payroll_actuals
  add column if not exists field_overrides jsonb,
  add column if not exists extra_additions jsonb not null default '[]'::jsonb,
  add column if not exists extra_deductions jsonb not null default '[]'::jsonb;
