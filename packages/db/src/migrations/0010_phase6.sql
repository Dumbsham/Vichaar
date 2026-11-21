CREATE TABLE IF NOT EXISTS milestones (
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = 'subscribers'),
  threshold integer NOT NULL CHECK (threshold IN (10, 100, 1000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, kind, threshold)
);

CREATE TABLE IF NOT EXISTS quote_cards (
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, quote_hash)
);
CREATE INDEX IF NOT EXISTS quote_cards_publication_post_idx ON quote_cards(publication_id, post_id);
