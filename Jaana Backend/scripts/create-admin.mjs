import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { passwordHash, passwordValue, emailValue } from '../server/staff-auth.js';
let rl;
try {
 let name,email,password;
 if(process.argv.includes('--stdin')) {
  let input=''; for await(const chunk of stdin){input+=chunk;if(input.length>4096)throw Error('Setup input is too large.');}
  ({name,email,password}=JSON.parse(input));
 } else {
  if(!stdin.isTTY)throw Error('Run in an interactive terminal, or supply JSON through stdin with --stdin.');
  let muted=false;
  const output=new Writable({write(chunk,encoding,callback){if(!muted)stdout.write(chunk,encoding);callback();}});
  rl=createInterface({input:stdin,output,terminal:true});
  name=await rl.question('First administrator name: ');
  email=await rl.question('Administrator email: ');
  stdout.write('Password (14+ characters, hidden): ');muted=true;
  password=await rl.question('');muted=false;stdout.write('\n');
  rl.close();
 }
 if(typeof name!=='string'||!name.trim()||name.trim().length>100)throw Error('Enter a name of 1 to 100 characters.');
 name=name.trim();email=emailValue(email);
 const digest=await passwordHash(passwordValue(password));
 const escape=value=>"'"+value.replaceAll("'","''")+"'";
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const sql=`INSERT INTO staff_users(id,name,email,role,password_hash,must_change_password,created_at) SELECT ${[id,name,email,'admin',digest].map(escape).join(',')},0,${escape(now)} WHERE NOT EXISTS (SELECT 1 FROM staff_users);\nINSERT OR IGNORE INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ${escape(crypto.randomUUID())},id,name,role,'staff.bootstrap',id,'{}',${escape(now)} FROM staff_users WHERE id=${escape(id)};\n`;
 await writeFile(new URL('../.staff-bootstrap.sql',import.meta.url),sql,{flag:'wx',mode:0o600});
 console.log('Created Jaana Backend/.staff-bootstrap.sql. Apply it only to the intended database. It creates an administrator only when no staff accounts exist.');
} catch(error){console.error(error.code==='EEXIST'?'The bootstrap SQL already exists. Apply or remove that intended file first.':error.message);process.exitCode=1;} finally {rl?.close();}

