import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ensurePostDeliveriesPartitions } from './partition-manager.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(databaseUrl?: string) {
  const connectionString = databaseUrl || process.env.DATABASE_URL || 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
  const pool = new Pool({ connectionString });

  try {
    console.log(`Connecting to database at ${connectionString.replace(/:[^:@]+@/, ':***@')}...`);
    const client = await pool.connect();

    try {
      // Find all sql files in migrations dir
      const migrationsDir = path.resolve(__dirname, 'migrations');
      if (fs.existsSync(migrationsDir)) {
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
        for (const file of files) {
          // The legacy runner replays every SQL file. This migration drops a constraint once.
          if (file === '0009_billing_renewals.sql') {
            const applied = await client.query("SELECT to_regclass('paid_subscriptions_open_unique') IS NOT NULL AS applied");
            if (applied.rows[0]?.applied === true) continue;
          }
          console.log(`Executing migration: ${file}...`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
        }
      }

      // Run partition maintenance
      console.log('Running partition maintenance...');
      const partitions = await ensurePostDeliveriesPartitions(pool);
      if (partitions.length > 0) {
        console.log(`Ensured partitions: ${partitions.join(', ')}`);
      } else {
        console.log('No partitioned tables pending maintenance.');
      }

      console.log('Migrations completed successfully.');
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// Execute directly if run as a script
if (process.argv[1] === __filename) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
