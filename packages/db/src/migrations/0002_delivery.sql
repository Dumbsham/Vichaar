CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id),
  email citext NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','unsubscribed')),
  slot text NOT NULL DEFAULT 'morning' CHECK (slot IN ('morning','afternoon','evening')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  confirmation_token_hash text,
  confirmation_expires_at timestamptz,
  confirmation_sent_at timestamptz,
  confirmation_dispatched_at timestamptz,
  confirmation_count integer NOT NULL DEFAULT 0,
  confirmation_day date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id,email),
  UNIQUE (publication_id,id)
);
CREATE INDEX IF NOT EXISTS subscriptions_active_page_idx ON subscriptions(publication_id,id) WHERE status='active';

CREATE TABLE IF NOT EXISTS suppressions (
  publication_id uuid NOT NULL REFERENCES publications(id),
  email citext NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id,email)
);

CREATE UNIQUE INDEX IF NOT EXISTS posts_publication_id_unique ON posts(publication_id,id);
CREATE TABLE IF NOT EXISTS post_deliveries (
  post_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  send_month date NOT NULL,
  publication_id uuid NOT NULL REFERENCES publications(id),
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sending','sent','failed','skipped','bounced')),
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id,subscription_id,send_month),
  FOREIGN KEY (publication_id,subscription_id) REFERENCES subscriptions(publication_id,id),
  FOREIGN KEY (publication_id,post_id) REFERENCES posts(publication_id,id)
) PARTITION BY RANGE (send_month);
CREATE TABLE IF NOT EXISTS post_deliveries_default PARTITION OF post_deliveries DEFAULT;
CREATE INDEX IF NOT EXISTS post_deliveries_due_idx ON post_deliveries(send_at,publication_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS post_deliveries_stale_idx ON post_deliveries(status,updated_at) WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS post_deliveries_publication_idx ON post_deliveries(publication_id,post_id);
