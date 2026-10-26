CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  session_token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  subdomain text NOT NULL UNIQUE,
  description text,
  primary_language text NOT NULL DEFAULT 'en',
  monthly_price_paise integer NOT NULL DEFAULT 0 CHECK (monthly_price_paise >= 0),
  sending_status text NOT NULL DEFAULT 'active' CHECK (sending_status IN ('active','paused')),
  daily_send_limit integer NOT NULL DEFAULT 100,
  subscriber_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publications_owner_id_id_idx ON publications(owner_id, id);
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id),
  slug text NOT NULL,
  title text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  access text NOT NULL DEFAULT 'free' CHECK (access IN ('free','paid')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
  scheduled_for timestamptz,
  published_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(publication_id, slug)
);
CREATE INDEX IF NOT EXISTS posts_publication_id_idx ON posts(publication_id, id);
CREATE INDEX IF NOT EXISTS posts_publication_status_published_idx ON posts(publication_id, status, published_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS post_contents (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL REFERENCES publications(id),
  body_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  html_preview text NOT NULL DEFAULT '',
  html_full text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS post_contents_publication_idx ON post_contents(publication_id, post_id);
CREATE TABLE IF NOT EXISTS outbox_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx ON outbox_events(id) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS tracked_links (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  target_url text NOT NULL CHECK (target_url ~* '^https?://')
);
CREATE INDEX IF NOT EXISTS tracked_links_publication_post_idx ON tracked_links(publication_id, post_id);
CREATE TABLE IF NOT EXISTS writing_streaks (
  publication_id uuid PRIMARY KEY REFERENCES publications(id),
  current_weeks integer NOT NULL DEFAULT 0,
  longest_weeks integer NOT NULL DEFAULT 0,
  last_post_week date
);
