alter table worktrack.settings
  add column if not exists shortfall_payout_month text not null default 'current';
