CREATE TABLE IF NOT EXISTS staff_users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','staff')), password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), must_change_password INTEGER NOT NULL DEFAULT 1,
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_sessions (
 token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_users(id),
 user_version INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_sessions_expiry ON staff_sessions(expires_at);
CREATE TABLE IF NOT EXISTS staff_audit (
 id TEXT PRIMARY KEY, staff_id TEXT, staff_name TEXT NOT NULL, staff_role TEXT NOT NULL,
 action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_audit_time ON staff_audit(created_at DESC,id);
CREATE INDEX IF NOT EXISTS staff_audit_actor ON staff_audit(staff_id,created_at);
CREATE TRIGGER IF NOT EXISTS staff_audit_no_update BEFORE UPDATE ON staff_audit BEGIN SELECT RAISE(ABORT,'Audit records cannot be edited'); END;
CREATE TRIGGER IF NOT EXISTS staff_audit_no_delete BEFORE DELETE ON staff_audit BEGIN SELECT RAISE(ABORT,'Audit records cannot be deleted'); END;
