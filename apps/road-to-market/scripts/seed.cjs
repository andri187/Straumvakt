const { Client } = require('pg');
const crypto = require('crypto');
const uuid = () => crypto.randomUUID();
const now = new Date().toISOString();
// PBKDF2 hash, format pbkdf2$sha256$<iters>$<saltHex>$<hashHex> — verified by the worker with Web Crypto.
function hashPw(pw){ const salt=crypto.randomBytes(16); const it=100000;
  const h=crypto.pbkdf2Sync(pw,salt,it,32,'sha256'); return `pbkdf2$sha256$${it}$${salt.toString('hex')}$${h.toString('hex')}`; }
const PW = hashPw('Straumvakt-Test-2026!');

(async()=>{
  const c = new Client({ connectionString: process.env.TEST_DB_DIRECT, ssl:{rejectUnauthorized:false} });
  await c.connect();
  const q = (s,p)=>c.query(s,p);
  await q(`TRUNCATE tenancy.organizations, identity.users CASCADE`);
  // ---- platform admin ----
  const admin = uuid();
  await q(`INSERT INTO identity.users(id,email,display_name,audience,updated_at) VALUES($1,$2,$3,'operator',$4)`,[admin,'admin@straumvakt-test.is','Test Platform Admin',now]);
  await q(`INSERT INTO identity.user_credentials(user_id,password_hash) VALUES($1,$2)`,[admin,PW]);
  await q(`INSERT INTO identity.platform_grants(user_id,role) VALUES($1,'super_user')`,[admin]);

  async function makeOrg(name, cc, hostEmail, drivers, chargerDefs, sessionCount){
    const org=uuid();
    await q(`INSERT INTO tenancy.organizations(id,display_name,country_code,roles,updated_at) VALUES($1,$2,$3,ARRAY['cpo']::tenancy."OrganizationRole"[],$4)`,[org,name,cc,now]);
    const host=uuid();
    await q(`INSERT INTO identity.users(id,email,display_name,audience,updated_at) VALUES($1,$2,$3,'operator',$4)`,[host,hostEmail,name+' Host Admin',now]);
    await q(`INSERT INTO identity.user_credentials(user_id,password_hash) VALUES($1,$2)`,[host,PW]);
    await q(`INSERT INTO tenancy.memberships(org_id,user_id,role) VALUES($1,$2,'host_admin')`,[org,host]);
    const prop=uuid(); await q(`INSERT INTO properties.properties(id,org_id,display_name,updated_at) VALUES($1,$2,$3,$4)`,[prop,org,name+' Property',now]);
    const site=uuid(); await q(`INSERT INTO properties.sites(id,org_id,property_id,display_name,updated_at) VALUES($1,$2,$3,$4,$5)`,[site,org,prop,name+' Main Site',now]);
    const inst=uuid(); await q(`INSERT INTO properties.installations(id,org_id,site_id,display_name,updated_at) VALUES($1,$2,$3,$4,$5)`,[inst,org,site,name+' Installation',now]);
    const chargers=[];
    for(const cd of chargerDefs){
      const sa=uuid();
      await q(`INSERT INTO properties.site_assets(id,org_id,site_id,kind,display_name,updated_at) VALUES($1,$2,$3,'charger',$4,$5)`,[sa,org,site,cd.name,now]);
      await q(`INSERT INTO assets.charging_stations(site_asset_id,org_id,installation_id,vendor,model,serial_number,online_since_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[sa,org,inst,cd.vendor,cd.model,cd.serial,now,now]);
      const evse=uuid();
      await q(`INSERT INTO assets.evses(id,org_id,charging_station_id,evse_index,updated_at) VALUES($1,$2,$3,1,$4)`,[evse,org,sa,now]);
      const conn=uuid();
      await q(`INSERT INTO assets.connectors(id,org_id,evse_id,connector_index,type,status,updated_at) VALUES($1,$2,$3,1,'type2',$4,$5)`,[conn,org,evse,cd.status||'Available',now]);
      await q(`INSERT INTO ocpp.ocpp_identities(id,org_id,charging_station_id,identity_string,ocpp_version,updated_at) VALUES($1,$2,$3,$4,'ocpp_1_6',$5)`,[uuid(),org,sa,cd.serial,now]);
      chargers.push({sa,evse,conn});
    }
    const agr=uuid();
    await q(`INSERT INTO agreements.agreements(id,agreement_type,counterparty_org_id,cpo_org_id,display_name,status,effective_from,updated_at) VALUES($1,'service_cpo',$2,$3,$4,'active',$5,$6)`,[agr,org,org,name+' CPO Agreement',now,now]);
    const dg=uuid();
    await q(`INSERT INTO agreements.driver_groups(id,agreement_id,owner_org_id,display_name,updated_at) VALUES($1,$2,$3,$4,$5)`,[dg,agr,org,name+' Drivers',now]);
    const driverIds=[];
    for(const d of drivers){
      const du=uuid();
      await q(`INSERT INTO identity.users(id,email,display_name,audience,updated_at) VALUES($1,$2,$3,'driver',$4)`,[du,d.email,d.name,now]);
      await q(`INSERT INTO tenancy.memberships(org_id,user_id,role) VALUES($1,$2,'driver')`,[org,du]);
      await q(`INSERT INTO agreements.driver_group_memberships(id,driver_group_id,user_id) VALUES($1,$2,$3)`,[uuid(),dg,du]);
      driverIds.push(du);
    }
    // sessions
    for(let i=0;i<sessionCount;i++){
      const ch=chargers[i%chargers.length]; const du=driverIds[i%driverIds.length];
      const sid=uuid();
      const started=new Date(Date.now()-(i+1)*86400000).toISOString();
      const ended=new Date(Date.now()-(i+1)*86400000+3600000).toISOString();
      const wh=15000+i*2500; const costMinor=Math.round((wh/1000)*23.5*100);
      await q(`INSERT INTO charging.sessions(id,org_id,site_id,charging_station_id,evse_id,connector_id,user_id,started_at,ended_at,energy_wh,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11)`,[sid,org,site,ch.sa,ch.evse,ch.conn,du,started,ended,wh,now]);
      await q(`INSERT INTO reports.session_ledger(session_id,org_id,driver_user_id,started_at,energy_kwh,cost_isk_minor) VALUES($1,$2,$3,$4,$5,$6)`,[sid,org,du,started,(wh/1000),costMinor]);
    }
    return {org,host,name,chargers:chargers.length,drivers:driverIds.length,sessions:sessionCount};
  }

  const A = await makeOrg('Norðurorka Test','IS','host@nordurorka-test.is',
    [{email:'anna@nordurorka-test.is',name:'Anna Driver'},{email:'bjorn@nordurorka-test.is',name:'Björn Driver'}],
    [{name:'Dalvegur A1',vendor:'Zaptec',model:'Pro',serial:'ZAP-NORD-001',status:'Available'},
     {name:'Dalvegur A2',vendor:'Zaptec',model:'Pro',serial:'ZAP-NORD-002',status:'Charging'},
     {name:'Dalvegur A3',vendor:'Easee',model:'Home',serial:'EAS-NORD-003',status:'Available'}], 6);
  const B = await makeOrg('Vestan Test','IS','host@vestan-test.is',
    [{email:'cara@vestan-test.is',name:'Cara Driver'}],
    [{name:'Hafnir B1',vendor:'Zaptec',model:'Pro',serial:'ZAP-VEST-001',status:'Available'},
     {name:'Hafnir B2',vendor:'Alfen',model:'Eve',serial:'ALF-VEST-002',status:'Unavailable'}], 3);
  await c.end();
  console.log('SEED OK'); console.log(JSON.stringify({admin,A,B},null,2));
})().catch(e=>{console.log('SEED ERROR:',e.message); process.exit(1);});
