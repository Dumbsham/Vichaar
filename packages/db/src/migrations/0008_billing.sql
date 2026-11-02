CREATE TABLE IF NOT EXISTS billing_plans (
  publication_id uuid NOT NULL REFERENCES publications(id),
  price_paise integer NOT NULL CHECK (price_paise >= 100),
  razorpay_plan_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, price_paise)
);

CREATE TABLE IF NOT EXISTS paid_subscriptions (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id),
  subscription_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  razorpay_subscription_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','active','halted','cancelled','expired')),
  price_paise integer NOT NULL CHECK (price_paise >= 100),
  current_period_end timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, subscription_id),
  FOREIGN KEY (publication_id, subscription_id) REFERENCES subscriptions(publication_id,id)
);
CREATE INDEX IF NOT EXISTS paid_subscriptions_user_pub_idx ON paid_subscriptions(user_id,publication_id);
CREATE INDEX IF NOT EXISTS paid_subscriptions_reconcile_idx ON paid_subscriptions(last_event_at,id)
  WHERE status IN ('created','active','halted');

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','ignored')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS webhook_events_pending_idx ON webhook_events(received_at,id) WHERE status='pending';
