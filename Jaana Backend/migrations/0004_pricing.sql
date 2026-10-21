CREATE TABLE delivery_pricing (id INTEGER PRIMARY KEY CHECK(id=1), per_km INTEGER NOT NULL, minimum_charge INTEGER NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO delivery_pricing VALUES(1,300,2000,strftime('%Y-%m-%dT%H:%M:%SZ','now'));
ALTER TABLE bookings ADD COLUMN shipment_json TEXT;
