import pg from 'pg';

export interface PartitionVerificationResult {
  ok: boolean;
  checkedMonths: string[];
  missingPartitions: string[];
}

/**
 * Returns formatted start and end dates for a month in UTC.
 * Month is 0-indexed (0 = Jan, 11 = Dec).
 */
function getMonthRange(
  year: number,
  monthIndex: number,
): { start: string; end: string; partitionSuffix: string } {
  const startDate = new Date(Date.UTC(year, monthIndex, 1));
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 1));

  const startMonthStr = String(monthIndex + 1).padStart(2, '0');
  const partitionSuffix = `${year}_${startMonthStr}`;

  return {
    start: startDate.toISOString().split('T')[0]!,
    end: endDate.toISOString().split('T')[0]!,
    partitionSuffix,
  };
}

/**
 * Ensures monthly partitions exist for post_deliveries:
 * 1. Creates post_deliveries_default as a defensive safety net.
 * 2. Creates monthly partitions for current month and next 3 months.
 */
export async function ensurePostDeliveriesPartitions(pool: pg.Pool): Promise<string[]> {
  // Check if parent table exists
  const tableCheck = await pool.query(
    `SELECT to_regclass('public.post_deliveries') as parent_table;`,
  );
  if (!tableCheck.rows[0]?.parent_table) {
    return [];
  }

  const created: string[] = [];

  // 1. Ensure DEFAULT partition exists so missing months never crash inserts
  await pool.query(
    `CREATE TABLE IF NOT EXISTS post_deliveries_default PARTITION OF post_deliveries DEFAULT;`,
  );
  created.push('post_deliveries_default');

  // 2. Pre-create current month and next 3 months
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  for (let offset = 0; offset <= 3; offset++) {
    const targetMonth = currentMonth + offset;
    const targetYear = currentYear + Math.floor(targetMonth / 12);
    const normalizedMonth = targetMonth % 12;

    const { start, end, partitionSuffix } = getMonthRange(targetYear, normalizedMonth);
    const tableName = `post_deliveries_${partitionSuffix}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A missing month can receive rows in DEFAULT. Move them before ATTACH,
      // because PostgreSQL refuses a new range while DEFAULT overlaps it.
      await client.query('LOCK TABLE post_deliveries IN ACCESS EXCLUSIVE MODE');
      const attached = await client.query<{ attached: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM pg_inherits WHERE inhparent='post_deliveries'::regclass AND inhrelid=to_regclass($1)
        ) AS attached`,
        [tableName],
      );
      if (!attached.rows[0]?.attached) {
        const overlap = await client.query(
          'SELECT 1 FROM post_deliveries_default WHERE send_month >= $1::date AND send_month < $2::date LIMIT 1',
          [start, end],
        );
        if (overlap.rowCount) {
          await client.query(
            `CREATE TABLE IF NOT EXISTS ${tableName} (LIKE post_deliveries INCLUDING ALL)`,
          );
          await client.query(
            `INSERT INTO ${tableName} SELECT * FROM post_deliveries_default WHERE send_month >= $1::date AND send_month < $2::date`,
            [start, end],
          );
          await client.query(
            'DELETE FROM post_deliveries_default WHERE send_month >= $1::date AND send_month < $2::date',
            [start, end],
          );
          await client.query(
            `ALTER TABLE post_deliveries ATTACH PARTITION ${tableName} FOR VALUES FROM ('${start}') TO ('${end}')`,
          );
        } else {
          await client.query(
            `CREATE TABLE IF NOT EXISTS ${tableName} PARTITION OF post_deliveries FOR VALUES FROM ('${start}') TO ('${end}')`,
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    created.push(tableName);
  }

  return created;
}

/**
 * Verifies that partitions covering current and upcoming month exist.
 * Used during application startup to alert if partition maintenance fell behind.
 */
export async function verifyPostDeliveriesPartitions(
  pool: pg.Pool,
): Promise<PartitionVerificationResult> {
  const tableCheck = await pool.query(
    `SELECT to_regclass('public.post_deliveries') as parent_table;`,
  );
  if (!tableCheck.rows[0]?.parent_table) {
    return { ok: true, checkedMonths: [], missingPartitions: [] };
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  const checkedMonths: string[] = [];
  const missingPartitions: string[] = [];

  for (let offset = 0; offset <= 1; offset++) {
    const targetMonth = currentMonth + offset;
    const targetYear = currentYear + Math.floor(targetMonth / 12);
    const normalizedMonth = targetMonth % 12;

    const { partitionSuffix } = getMonthRange(targetYear, normalizedMonth);
    const tableName = `post_deliveries_${partitionSuffix}`;
    checkedMonths.push(tableName);

    const check = await pool.query(`SELECT to_regclass($1) as partition_table;`, [
      `public.${tableName}`,
    ]);

    if (!check.rows[0]?.partition_table) {
      missingPartitions.push(tableName);
    }
  }

  return {
    ok: missingPartitions.length === 0,
    checkedMonths,
    missingPartitions,
  };
}
