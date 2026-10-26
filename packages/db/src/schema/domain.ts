import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  bigserial,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const utc = (name: string) => timestamp(name, { withTimezone: true });
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  createdAt: utc('created_at').notNull().defaultNow(),
});
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    sessionTokenHash: text('session_token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: utc('expires_at').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
    lastSeenAt: utc('last_seen_at').notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);
export const publications = pgTable(
  'publications',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    subdomain: text('subdomain').notNull().unique(),
    description: text('description'),
    primaryLanguage: text('primary_language').notNull().default('en'),
    monthlyPricePaise: integer('monthly_price_paise').notNull().default(0),
    sendingStatus: text('sending_status').notNull().default('active'),
    dailySendLimit: integer('daily_send_limit').notNull().default(100),
    subscriberCount: integer('subscriber_count').notNull().default(0),
    createdAt: utc('created_at').notNull().defaultNow(),
    updatedAt: utc('updated_at').notNull().defaultNow(),
  },
  (table) => [index('publications_owner_id_id_idx').on(table.ownerId, table.id)],
);
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    language: text('language').notNull().default('en'),
    access: text('access').notNull().default('free'),
    status: text('status').notNull().default('draft'),
    scheduledFor: utc('scheduled_for'),
    publishedAt: utc('published_at'),
    version: integer('version').notNull().default(1),
    createdAt: utc('created_at').notNull().defaultNow(),
    updatedAt: utc('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('posts_publication_slug_unique').on(table.publicationId, table.slug),
    index('posts_publication_id_idx').on(table.publicationId, table.id),
    index('posts_publication_status_published_idx').on(
      table.publicationId,
      table.status,
      table.publishedAt,
      table.id,
    ),
  ],
);
export const postContents = pgTable(
  'post_contents',
  {
    postId: uuid('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id),
    bodyJson: jsonb('body_json')
      .notNull()
      .default(sql`'{}'::jsonb`),
    htmlPreview: text('html_preview').notNull().default(''),
    htmlFull: text('html_full').notNull().default(''),
  },
  (table) => [index('post_contents_publication_idx').on(table.publicationId, table.postId)],
);
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
    publishedAt: utc('published_at'),
  },
  (table) => [
    index('outbox_events_unpublished_idx')
      .on(table.id)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);
export const trackedLinks = pgTable(
  'tracked_links',
  {
    id: uuid('id').primaryKey(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    targetUrl: text('target_url').notNull(),
  },
  (table) => [index('tracked_links_publication_post_idx').on(table.publicationId, table.postId)],
);
export const writingStreaks = pgTable('writing_streaks', {
  publicationId: uuid('publication_id')
    .primaryKey()
    .references(() => publications.id),
  currentWeeks: integer('current_weeks').notNull().default(0),
  longestWeeks: integer('longest_weeks').notNull().default(0),
  lastPostWeek: date('last_post_week'),
});
