CREATE TABLE IF NOT EXISTS booking_notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reference TEXT NOT NULL UNIQUE REFERENCES bookings(reference),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_reads (
 notification_id INTEGER NOT NULL REFERENCES booking_notifications(id),
 staff_id TEXT NOT NULL REFERENCES staff_users(id),
 read_at TEXT NOT NULL,
 PRIMARY KEY(notification_id,staff_id)
);
CREATE TABLE IF NOT EXISTS booking_acknowledgements (
 reference TEXT PRIMARY KEY REFERENCES bookings(reference),
 staff_id TEXT NOT NULL REFERENCES staff_users(id),
 staff_name TEXT NOT NULL,
 acknowledged_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_reads_staff ON notification_reads(staff_id,notification_id);
CREATE TRIGGER IF NOT EXISTS booking_notification_created AFTER INSERT ON bookings
BEGIN
 INSERT INTO booking_notifications(reference,created_at) VALUES(NEW.reference,NEW.created_at);
END;
INSERT INTO booking_notifications(reference,created_at)
 SELECT reference,created_at FROM bookings WHERE 1 ORDER BY created_at,reference
 ON CONFLICT(reference) DO NOTHING;
