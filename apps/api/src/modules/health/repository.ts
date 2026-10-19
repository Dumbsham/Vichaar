import type { Pool } from '@vichaar/db';

export interface HealthRepository {
  pingDatabase(): Promise<boolean>;
}

export function createHealthRepository({ pool }: { pool: Pool }): HealthRepository {
  return {
    async pingDatabase(): Promise<boolean> {
      try {
        const res = await pool.query('SELECT 1 as healthy;');
        return res.rows[0]?.healthy === 1;
      } catch {
        return false;
      }
    },
  };
}
