import { uuidv7 } from 'uuidv7';

/**
 * Generates an application-level UUIDv7.
 * Standard RFC 9562 time-ordered 128-bit identifier, optimized for PostgreSQL B-tree indexing.
 */
export function generateId(): string {
  return uuidv7();
}
