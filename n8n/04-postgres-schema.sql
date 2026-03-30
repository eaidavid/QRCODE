create table if not exists whatsapp_pix_transactions (
  id bigserial primary key,
  channel text not null default 'whatsapp',
  group_id text,
  user_id text,
  user_name text,
  phone text,
  operator_login text not null,
  external_id text unique,
  reference text unique,
  amount_cents integer,
  amount_formatted text,
  code text,
  image text,
  reply_text text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  webhook_payload jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_whatsapp_pix_transactions_status
  on whatsapp_pix_transactions (status);

create index if not exists idx_whatsapp_pix_transactions_operator
  on whatsapp_pix_transactions (operator_login);

create index if not exists idx_whatsapp_pix_transactions_created_at
  on whatsapp_pix_transactions (created_at desc);

create index if not exists idx_whatsapp_pix_transactions_channel_status
  on whatsapp_pix_transactions (channel, status);
