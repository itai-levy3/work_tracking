alter table worktrack.settings
  add column if not exists overtime_payout_month text not null default 'current';
