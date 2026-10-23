ALTER TABLE staff_users ADD COLUMN mfa_generation TEXT;
﻿ALTER TABLE staff_users ADD COLUMN mfa_secret TEXT;
ALTER TABLE staff_users ADD COLUMN mfa_pending TEXT;
ALTER TABLE staff_users ADD COLUMN mfa_pending_exp TEXT;
ALTER TABLE staff_users ADD COLUMN mfa_counter INTEGER NOT NULL DEFAULT -1;
CREATE TABLE staff_recovery_codes (
 staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL,
 PRIMARY KEY(staff_id,code_hash)
);
