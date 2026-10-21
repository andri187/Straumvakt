const { Client } = require('pg'); const crypto = require('crypto');
function hashPw(pw){ const salt=crypto.randomBytes(16); const it=100000;
  const h=crypto.pbkdf2Sync(pw,salt,it,32,'sha256'); return `pbkdf2$sha256$${it}$${salt.toString('hex')}$${h.toString('hex')}`; }
(async()=>{
  const c=new Client({connectionString:process.env.TEST_DB_DIRECT, ssl:{rejectUnauthorized:false}}); await c.connect();
  const hash=hashPw('Straumvakt-Test-2026!');
  const r=await c.query(`UPDATE identity.user_credentials SET password_hash=$1`,[hash]);
  console.log('updated credential rows:', r.rowCount);
  await c.end();
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
