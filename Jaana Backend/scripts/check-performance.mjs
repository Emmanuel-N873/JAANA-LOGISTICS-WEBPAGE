import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const db = new DatabaseSync(':memory:');
try {
  const root = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(root)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(new URL(file, root), 'utf8'));
  const insert = db.prepare(
    `INSERT INTO bookings(reference,idempotency_key,payload_hash,customer_name,customer_phone,service,delivery_date,recipient_name,recipient_phone,package_size,pickup_address,delivery_address,package_details,created_at,updated_at) VALUES(?,?,'hash',?,'08000000000','Document Delivery','2026-10-24','Recipient','08000000001','Envelope or document','Ikeja warehouse','Lekki delivery','Documents','2026-10-23T12:00:00Z','2026-10-23T12:00:00Z')`
  );
  db.exec('BEGIN');
  for (let i = 0; i < 10000; i++)
    insert.run('JAANA-benchmark-' + i, 'benchmark-key-' + i, 'Customer ' + i);
  for (let i = 0; i < 10000; i++)
    db.prepare('INSERT INTO api_rate_limits VALUES(?,1,1)').run('expired-' + i);
  db.exec('COMMIT');
  const cases = [
    [
      'indexed rate cleanup',
      'SELECT bucket FROM api_rate_limits WHERE expires_at<2 ORDER BY expires_at LIMIT 50',
    ],
    [
      'indexed status filter',
      "SELECT reference FROM bookings WHERE status='requested' ORDER BY created_at DESC,reference LIMIT 20",
    ],
    [
      'indexed full-text search',
      `SELECT reference FROM bookings WHERE rowid IN(SELECT rowid FROM bookings_search WHERE bookings_search MATCH '"customer 999"*')`,
    ],
  ];
  for (const [label, sql] of cases) {
    const plan = db
      .prepare('EXPLAIN QUERY PLAN ' + sql)
      .all()
      .map((r) => r.detail);
    const times = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      db.prepare(sql).all();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify({ label, rows: 10000, p95Milliseconds: Number(times[23].toFixed(3)), plan })
    );
  }
  console.log(
    'Synthetic in-memory SQLite measurements only; not a Cloudflare production capacity claim.'
  );
} finally {
  db.close();
}
