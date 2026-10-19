import pg from 'pg';

const { Pool } = pg;

export async function seed(databaseUrl?: string) {
  const connectionString = databaseUrl || process.env.DATABASE_URL || 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
  const pool = new Pool({ connectionString });

  try {
    console.log('Seeding baseline demo data...');
    // Phase 1A baseline seed verification
    const res = await pool.query('SELECT count(*) as count FROM schema_version;');
    console.log(`Schema version record count: ${res.rows[0]?.count}`);
    console.log('Seeding completed.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
