alter table worktrack.settings
  add column if not exists chol_hamoed_mode text not null default 'three_quarters_work';

alter table worktrack.work_hours
  add column if not exists overtime_target_hours numeric;
