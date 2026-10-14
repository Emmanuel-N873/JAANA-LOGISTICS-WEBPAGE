CREATE TABLE IF NOT EXISTS bookings (
  reference TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  package_size TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  package_details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK(status IN ('requested','confirmed','picked_up','in_transit','delivered','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_update_id TEXT
);
CREATE INDEX IF NOT EXISTS bookings_created ON bookings(created_at DESC, reference);
CREATE TABLE IF NOT EXISTS booking_events (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL REFERENCES bookings(reference) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_reference ON booking_events(reference, created_at);
CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
