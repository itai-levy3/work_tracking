alter table worktrack.settings
  add column if not exists fixed_components_in_gross boolean not null default true;
