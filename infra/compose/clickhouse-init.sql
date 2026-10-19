CREATE DATABASE IF NOT EXISTS vichaar;

CREATE TABLE IF NOT EXISTS vichaar.email_events (
    event_id UUID,
    publication_id UUID,
    post_id UUID,
    subscription_id UUID,
    link_id Nullable(UUID),
    event_type LowCardinality(String),
    is_prefetch UInt8,
    occurred_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (publication_id, post_id, event_type, event_id);
