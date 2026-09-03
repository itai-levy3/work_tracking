alter table worktrack.settings
  add column if not exists food_presets jsonb not null default '[]'::jsonb;
