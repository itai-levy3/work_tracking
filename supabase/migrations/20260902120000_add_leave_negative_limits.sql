alter table worktrack.settings
  add column if not exists vacation_negative_limit integer,
  add column if not exists sick_negative_limit integer;
