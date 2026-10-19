import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { generateId } from '../id.js';

export const schemaVersion = pgTable('schema_version', {
  id: uuid('id').primaryKey().$defaultFn(() => generateId()),
  version: varchar('version', { length: 64 }).notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SchemaVersion = typeof schemaVersion.$inferSelect;
export type NewSchemaVersion = typeof schemaVersion.$inferInsert;
