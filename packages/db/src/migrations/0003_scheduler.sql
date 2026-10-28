CREATE TABLE IF NOT EXISTS scheduler_state (
  name text PRIMARY KEY,
  after_publication_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO scheduler_state(name) VALUES('delivery') ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS post_deliveries_daily_budget_idx ON post_deliveries(publication_id,updated_at)
  WHERE status IN ('queued','sending','sent','failed');
