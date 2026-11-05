import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { emailValue, passwordHash, passwordValue } from '../server/staff-auth.js';
let rl;
try {
  if (!stdin.isTTY) throw Error('Run this owner-only recovery tool in an interactive terminal.');
  let muted = false;
  rl = createInterface({
    input: stdin,
    output: new Writable({
      write(chunk, encoding, done) {
        if (!muted) stdout.write(chunk, encoding);
        done();
      },
    }),
    terminal: true,
  });
  const email = emailValue(await rl.question('Existing staff email to recover: '));
  const operator = (await rl.question('Your name (database owner performing recovery): ')).trim();
  const reason = (await rl.question('How did you independently verify the account owner? ')).trim();
  if (operator.length < 2 || operator.length > 100 || reason.length < 12 || reason.length > 500)
    throw Error('Enter an operator name and identity-verification reason.');
  if (
    (await rl.question('This revokes sessions and removes MFA. Type RECOVER to generate SQL: ')) !==
    'RECOVER'
  )
    throw Error('Recovery cancelled.');
  stdout.write('New temporary password (14+ characters, hidden): ');
  muted = true;
  const password = await rl.question('');
  muted = false;
  stdout.write('\n');
  const digest = await passwordHash(passwordValue(password)),
    escape = (value) => "'" + value.replaceAll("'", "''") + "'",
    now = new Date().toISOString();
  const sql = `UPDATE staff_users SET password_hash=${escape(digest)},active=1,must_change_password=1,mfa_secret=NULL,mfa_pending=NULL,mfa_pending_exp=NULL,mfa_counter=-1,mfa_generation=NULL,version=version+1 WHERE email=${escape(email)};
DELETE FROM staff_sessions WHERE staff_id IN (SELECT id FROM staff_users WHERE email=${escape(email)});
DELETE FROM staff_recovery_codes WHERE staff_id IN (SELECT id FROM staff_users WHERE email=${escape(email)});
INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ${escape(crypto.randomUUID())},NULL,${escape(operator)},'database-owner','staff.owner_recovery',id,${escape(JSON.stringify({ reason }))},${escape(now)} FROM staff_users WHERE email=${escape(email)};
`;
  await writeFile(new URL('../.staff-recovery.sql', import.meta.url), sql, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    'Created .staff-recovery.sql. Confirm the database and target account, apply with Wrangler, then delete this file. No database changes were made by this tool.'
  );
} catch (error) {
  console.error(
    error.code === 'EEXIST' ? 'Recovery SQL already exists; review that file first.' : error.message
  );
  process.exitCode = 1;
} finally {
  rl?.close();
}
