alter table worktrack.settings
  add column if not exists employment_type text not null default 'full_time',
  add column if not exists part_time_monthly_target_hours numeric not null default 0;
