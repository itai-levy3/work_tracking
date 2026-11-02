alter table worktrack.settings
  add column if not exists night_shift_enabled boolean not null default false,
  add column if not exists night_shift_hours numeric(4,2) not null default 7,
  add column if not exists night_shift_rate_percent numeric(6,2) not null default 125,
  add column if not exists night_shift_overtime_rate_percent numeric(6,2) not null default 150;

alter table worktrack.work_hours
  add column if not exists night boolean not null default false;
