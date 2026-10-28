ALTER TABLE post_deliveries ADD COLUMN IF NOT EXISTS send_immediately boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS post_deliveries_subscription_pending_idx ON post_deliveries(publication_id,subscription_id,post_id,send_month)
  WHERE status='pending';
