alter table worktrack.settings
  add column if not exists evening_shift_rate_percent numeric(6,2),
  add column if not exists evening_shift_overtime_rate_percent numeric(6,2),
  drop column if exists night_shift_enabled,
  drop column if exists night_shift_hours,
  drop column if exists night_shift_rate_percent,
  drop column if exists night_shift_overtime_rate_percent;

alter table worktrack.work_hours
  drop column if exists night;
