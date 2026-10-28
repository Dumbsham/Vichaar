ALTER TABLE posts ADD COLUMN IF NOT EXISTS delivery_month date;
UPDATE posts SET delivery_month=date_trunc('month',COALESCE(published_at,scheduled_for,created_at))::date
  WHERE status<>'draft' AND delivery_month IS NULL;
