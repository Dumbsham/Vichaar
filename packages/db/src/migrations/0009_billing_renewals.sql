ALTER TABLE paid_subscriptions DROP CONSTRAINT paid_subscriptions_publication_id_subscription_id_key;
CREATE INDEX paid_subscriptions_subscription_history_idx
  ON paid_subscriptions(publication_id,subscription_id,created_at DESC);
CREATE UNIQUE INDEX paid_subscriptions_open_unique
  ON paid_subscriptions(publication_id,subscription_id)
  WHERE status IN ('created','active','halted');
