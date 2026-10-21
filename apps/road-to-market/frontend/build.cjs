const fs = require('node:fs');
let source = fs.readFileSync('src/base-v1.js', 'utf8');
function replaceLine(prefix, replacement) {
  const lines = source.split('\n');
  const index = lines.findIndex(line => line.startsWith(prefix));
  if (index < 0) throw new Error('Missing base anchor: ' + prefix);
  lines[index] = replacement;
  source = lines.join('\n');
}
replaceLine('const scopedSites=', 'const scopedSites=()=>sites.filter(s=>inScope(s.org));');
replaceLine('const scopedChargers=', 'const scopedChargers=()=>chargers.filter(c=>inScope(c.org));');
replaceLine('const nav=', 'const nav=()=>v2Nav();');
replaceLine('const route=', 'const route=(p,r=role)=>`#/${r}/${p}${r===\'admin\'&&selectedOrg!==\'all\'?\'?org=\'+encodeURIComponent(selectedOrg):\'\'}`;');
replaceLine('function content()', 'function content(){return v2Content();}');
replaceLine('function render()', 'function render(){syncContext();v2Render();}');
replaceLine('function navigate()', 'function navigate(){v2Navigate();}');
replaceLine('function record(', 'function record(action,target,org){v2Record(action,target,org);}');
source=source.replace("function billingPage(){if(role==='admin')", "function billingPage(){if(page==='platform-billing')");
source=source.replaceAll('sessions.filter(', 'scopedSessions().filter(').replaceAll('sessions.map(', 'scopedSessions().map(').replaceAll('sessions.reduce(', 'scopedSessions().reduce(').replaceAll('${sessions.length}', '${scopedSessions().length}');
source=source.replaceAll('drivers.filter(', 'scopedDrivers().filter(').replaceAll('incidents.filter(', 'scopedIncidents().filter(');
source=source.replace("audit.filter(a=>role==='admin'||a.org==='nordur')", 'audit.filter(a=>inScope(a.org))');
source=source.replace('All Norður Eignir sites', '${esc(orgName(contextOrg()))} · assigned sites');
source=source.replace("moreActions('save-tariff');", "v2Action('save-tariff');");
source=source.replaceAll('<h1>${title}</h1>','<h1>${esc(title)}</h1>').replaceAll('<p>${sub}</p>','<p>${esc(sub)}</p>');
for(const name of ['s.name','s.city','s.type','siteName(s.site)','orgName(a.org)'])source=source.replaceAll('${'+name+'}','${esc('+name+')}');
source=source.replaceAll("pill(s.offline?'1 offline':'Operational',s.offline?'warn':'good')",'siteHealth(s)');
source=source.replace("${c.status==='Offline'?'10:42 · stale':'11:24'}", "${c.status==='Awaiting connection'?'Never connected':c.status==='Offline'?'10:42 · stale':'11:24'}");
source=source.replace("c.status==='Offline'?'10:42 · stale':'11:24'", "c.status==='Awaiting connection'?'Never connected':c.status==='Offline'?'10:42 · stale':'11:24'");
source=source.replace("pill(c.status,c.status==='Charging'?'blue':c.status==='Offline'?'warn':'good')", "pill(c.status,c.status==='Available'?'good':c.status==='Charging'?'blue':'warn')");
source=source.replace("['Available','Charging','Offline']:[]", "['Available','Charging','Offline','Awaiting connection','Maintenance']:[]");
source=source.replaceAll('s.load/s.limit*100','s.limit?s.load/s.limit*100:0');
source=source.replaceAll('aria-valuemax="${s.limit}"','aria-valuemax="${Math.max(1,s.limit)}"');
source=source.replace('${s.load} / ${s.limit} kW','${s.limit?num(s.load)+\' / \'+s.limit+\' kW\':\'Supply not configured\'}');
source=source.replace("const {action,id}=b.dataset;if(moreActions(action,id))return;", "const {action,id}=b.dataset;if(v2Action(action,id))return;if(moreActions(action,id))return;");
source=source.replace("if(action==='assign'){const i=", "if(action==='assign'){const i=");
// CONNECTED TEST BUILD: swap the initial in-memory render for the API bootstrap.
source=source.replace("window.addEventListener('hashchange',navigate);navigate();","window.addEventListener('hashchange',navigate);connectBootstrap();");
const insert=source.indexOf("document.addEventListener('click'");
if(insert<0)throw new Error('Missing event boundary');
// inject console-v2 then connect.js into the same closure scope
source=source.slice(0,insert)+fs.readFileSync('src/console-v2.js','utf8')+'\n'+fs.readFileSync('src/connect.js','utf8')+'\n'+source.slice(insert);
const out=require('node:path').join(__dirname,'..','public','app.js');
fs.writeFileSync(out,source);
new Function(source);
console.log('Built connected Straumvakt console -> '+out);
