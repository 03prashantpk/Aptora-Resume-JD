// One-off: grant extra runs today by seeding a NEGATIVE ai_calls on TODAY's usage row.
// Usage: node scripts/_grant.cjs <owner_id> <signedValue>
// e.g.   node scripts/_grant.cjs user:ebd86ca4-36d0-4ac7-a500-14f64db0a211 -50
const pg = require("pg");
const fs = require("fs");
const url = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length).trim();
const owner = process.argv[2];
const val = Number(process.argv[3]);
if (!owner || !Number.isFinite(val)) { console.error("usage: node scripts/_grant.cjs <owner_id> <signedValue>"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url });
(async () => {
  await pool.query(
    `INSERT INTO usage (owner_id, day, ai_calls) VALUES ($1, current_date, $2)
     ON CONFLICT (owner_id, day) DO UPDATE SET ai_calls = $2`,
    [owner, val],
  );
  const r = await pool.query(
    "SELECT owner_id, day, ai_calls, exports_used, byok_ai_calls FROM usage WHERE owner_id=$1 AND day=current_date",
    [owner],
  );
  console.table(r.rows);
  await pool.end();
})();
