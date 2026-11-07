// Grant a user EXTRA RUNS that PERSIST across days (no daily re-granting).
// This adds to credit_balance.credits — the same balance paid top-ups use — so the
// grant never expires, carries over every day, and is consumed automatically after the
// free daily budget. This is the correct way to "give someone more runs", NOT a
// negative ai_calls on today's usage row (that dies at midnight).
//
// Usage:
//   node scripts/_grant.cjs <owner_id> <credits>          # add N credits (persistent)
//   node scripts/_grant.cjs <owner_id> pro [days]         # grant Pro (default 365 days)
//
// Examples:
//   node scripts/_grant.cjs user:3aea9298-15ea-4d25-bbb1-f5bdfcd011fb 50
//   node scripts/_grant.cjs user:3aea9298-15ea-4d25-bbb1-f5bdfcd011fb pro 365
const pg = require("pg");
const fs = require("fs");
const url = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length).trim();
const owner = process.argv[2];
const arg = process.argv[3];
if (!owner || !arg) {
  console.error("usage: node scripts/_grant.cjs <owner_id> <credits> | <owner_id> pro [days]");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
(async () => {
  if (String(arg).toLowerCase() === "pro") {
    const days = Number(process.argv[4] ?? 365);
    await pool.query(
      `INSERT INTO credit_balance (owner_id, pro_until) VALUES ($1, now() + ($2 || ' days')::interval)
       ON CONFLICT (owner_id) DO UPDATE SET
         pro_until = GREATEST(COALESCE(credit_balance.pro_until, now()), now() + ($2 || ' days')::interval),
         updated_at = now()`,
      [owner, String(days)],
    );
    console.log(`Granted Pro for ${days} days to ${owner}`);
  } else {
    const credits = Number(arg);
    if (!Number.isFinite(credits) || credits <= 0) { console.error("credits must be a positive number"); process.exit(1); }
    await pool.query(
      `INSERT INTO credit_balance (owner_id, credits) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET credits = credit_balance.credits + $2, updated_at = now()`,
      [owner, credits],
    );
    console.log(`Added ${credits} persistent credits to ${owner}`);
  }
  const r = await pool.query("SELECT owner_id, credits, pro_until FROM credit_balance WHERE owner_id=$1", [owner]);
  console.table(r.rows);
  await pool.end();
})();
