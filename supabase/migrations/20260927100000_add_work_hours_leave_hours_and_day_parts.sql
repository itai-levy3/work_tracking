alter table worktrack.work_hours
  add column if not exists remainder_paid boolean,
  add column if not exists leave_hours numeric,
  add column if not exists day_parts jsonb;
