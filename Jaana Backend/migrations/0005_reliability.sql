-- Bounded cleanup and covering indexes for common dashboard filters.
CREATE INDEX IF NOT EXISTS api_rate_limits_expiry ON api_rate_limits(expires_at);
CREATE INDEX IF NOT EXISTS bookings_status_updated ON bookings(status, updated_at);
CREATE INDEX IF NOT EXISTS bookings_status_created ON bookings(status, created_at DESC, reference);
CREATE INDEX IF NOT EXISTS bookings_delivery_created ON bookings(delivery_date, created_at DESC, reference);
ALTER TABLE bookings ADD COLUMN request_hash TEXT;
-- Indexed word/prefix search; external content avoids a second copy of the source columns.
CREATE VIRTUAL TABLE bookings_search USING fts5(reference,customer_name,pickup_address,delivery_address,content='bookings',content_rowid='rowid',prefix='2 3 4');
INSERT INTO bookings_search(bookings_search) VALUES('rebuild');
CREATE TRIGGER bookings_search_insert AFTER INSERT ON bookings BEGIN
 INSERT INTO bookings_search(rowid,reference,customer_name,pickup_address,delivery_address) VALUES(new.rowid,new.reference,new.customer_name,new.pickup_address,new.delivery_address);
END;
CREATE TRIGGER bookings_search_delete AFTER DELETE ON bookings BEGIN
 INSERT INTO bookings_search(bookings_search,rowid,reference,customer_name,pickup_address,delivery_address) VALUES('delete',old.rowid,old.reference,old.customer_name,old.pickup_address,old.delivery_address);
END;
CREATE TRIGGER bookings_search_update AFTER UPDATE OF reference,customer_name,pickup_address,delivery_address ON bookings BEGIN
 INSERT INTO bookings_search(bookings_search,rowid,reference,customer_name,pickup_address,delivery_address) VALUES('delete',old.rowid,old.reference,old.customer_name,old.pickup_address,old.delivery_address);
 INSERT INTO bookings_search(rowid,reference,customer_name,pickup_address,delivery_address) VALUES(new.rowid,new.reference,new.customer_name,new.pickup_address,new.delivery_address);
END;
