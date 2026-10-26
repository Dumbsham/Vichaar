import type { Pool } from '@vichaar/db';
import { generateId } from '@vichaar/db';

export interface AuthUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  timezone: string;
  created_at: Date;
}
export interface AuthRepository {
  createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    timezone: string;
  }): Promise<AuthUser | null>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<AuthUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
}
export function createAuthRepository({ pool }: { pool: Pool }): AuthRepository {
  return {
    async createUser(input) {
      const result = await pool.query<AuthUser>(
        `INSERT INTO users (id,email,password_hash,display_name,timezone) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO NOTHING RETURNING *`,
        [generateId(), input.email, input.passwordHash, input.name, input.timezone],
      );
      return result.rows[0] ?? null;
    },
    async findUserByEmail(email) {
      const result = await pool.query<AuthUser>('SELECT * FROM users WHERE email=$1', [email]);
      return result.rows[0] ?? null;
    },
    async createSession(input) {
      await pool.query(
        'INSERT INTO sessions (id,session_token_hash,user_id,expires_at) VALUES ($1,$2,$3,$4)',
        [generateId(), input.tokenHash, input.userId, input.expiresAt],
      );
    },
    async findSession(tokenHash, now) {
      const result = await pool.query<AuthUser>(
        `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.session_token_hash=$1 AND s.expires_at>$2`,
        [tokenHash, now],
      );
      return result.rows[0] ?? null;
    },
    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM sessions WHERE session_token_hash=$1', [tokenHash]);
    },
  };
}
