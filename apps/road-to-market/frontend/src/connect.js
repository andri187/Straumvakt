// connect.js — binds the console to the real test API (same origin).
// Concatenated UNWRAPPED into the app IIFE so it can read/mutate the app's
// closure state (orgs, role, contextOrg, render, ...). Replaces the initial
// navigate() with connectBootstrap(): authenticate -> hydrate real data ->
// render. Everything that has no real backend is left empty or clearly
// labelled; all writes are blocked (this test API is read-only).

let IDENTITY = null;
const cap/*alize*/ = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
         d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
async function apiGet(path) {
  const r = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
  return r;
}

// ---- login gate ----
function renderLogin(msg) {
  app.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:24px">
    <form id="rtm-login" style="width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><img src="favicon.svg" alt="" width="28" height="28"><strong style="font-size:18px">Straumvakt</strong></div>
      <div style="color:var(--muted);font-size:12px;margin-bottom:18px">Connected test build · sign in</div>
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">Email</label>
      <input id="rtm-email" type="email" autocomplete="username" required style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--raised);color:var(--ink);margin-bottom:12px">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">Password</label>
      <input id="rtm-pass" type="password" autocomplete="current-password" required style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--raised);color:var(--ink);margin-bottom:16px">
      ${msg ? `<div style="color:var(--bad);font-size:12px;margin-bottom:12px">${esc(msg)}</div>` : ""}
      <button type="submit" style="width:100%;padding:11px;border-radius:8px;border:0;background:var(--accent);color:#062;font-weight:600;cursor:pointer">Sign in</button>
      <div style="color:var(--muted);font-size:11px;margin-top:14px;line-height:1.5">Isolated test environment. Use a provided test account. No live fleet, email, or billing is reachable.</div>
    </form></div>`;
  document.getElementById("rtm-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("rtm-email").value.trim();
    const password = document.getElementById("rtm-pass").value;
    const r = await fetch("/api/admin/login", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    if (r.ok) { location.reload(); }
    else { renderLogin("Incorrect email or password."); }
  });
}

// ---- write blocking (read-only test API) ----
const WRITE_PREFIXES = ["new-", "edit-", "state-", "save-", "confirm-", "schedule-", "cancel-",
  "assign", "close-", "correct-", "approve-", "review-", "commission", "remote", "export-", "detect", "delete-"];
function isWriteAction(a) { return !!a && WRITE_PREFIXES.some((p) => a === p || a.startsWith(p)); }

// ---- hydration ----
async function loadOrg(orgId) {
  const [ch, dr, se, inst, si] = await Promise.all([
    apiGet(`/api/admin/orgs/${orgId}/chargers`).then((r) => (r.ok ? r.json() : { chargers: [] })),
    apiGet(`/api/admin/orgs/${orgId}/drivers`).then((r) => (r.ok ? r.json() : { drivers: [] })),
    apiGet(`/api/admin/orgs/${orgId}/sessions`).then((r) => (r.ok ? r.json() : { sessions: [] })),
    apiGet(`/api/admin/orgs/${orgId}/installations`).then((r) => (r.ok ? r.json() : { installations: [] })),
    apiGet(`/api/admin/orgs/${orgId}/sites`).then((r) => (r.ok ? r.json() : { sites: [] })),
  ]);
  for (const s of si.sites) sites.push({ id: s.id, name: s.displayName, org: orgId, city: "", type: "", count: s.chargerCount || 0, charging: 0, offline: 0, energy: 0, limit: 0, load: 0 });
  for (const c of ch.chargers) chargers.push({ id: c.id, site: c.siteId || "", name: c.name, code: c.serial || "", status: c.status || "Available", power: null, model: [c.vendor, c.model].filter(Boolean).join(" "), org: orgId, installation: c.installationId || "" });
  for (const s of sites.filter((x) => x.org === orgId)) {
    const cs = chargers.filter((c) => c.site === s.id);
    s.count = cs.length; s.charging = cs.filter((c) => c.status === "Charging").length;
    s.offline = cs.filter((c) => c.status === "Unavailable" || c.status === "Offline").length;
  }
  for (const d of dr.drivers) drivers.push({ id: d.userId, name: d.displayName, email: d.email, group: d.group || "—", site: "", status: cap(d.status || "active"), org: orgId });
  for (const s of se.sessions) {
    const durMin = s.endedAt ? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000) : 0;
    sessions.push({ id: s.id, site: "", driver: s.driver || "—", connector: s.charger || "", start: fmtDate(s.startedAt), duration: durMin, energy: s.energyWh ? +(s.energyWh / 1000).toFixed(1) : 0, status: cap(s.status || ""), bill: "Ready", cost: s.costIskMinor != null ? Math.round(s.costIskMinor / 100) : null, org: orgId });
  }
  for (const i of inst.installations) installations.push({ id: i.id, org: orgId, site: i.site || "", name: i.displayName, meter: "—", supply: 0, installer: "—", status: "Commissioned" });
  const org = orgs.find((o) => o.id === orgId);
  if (org) { org.sites = sites.filter((s) => s.org === orgId).length; org.connectors = chargers.filter((c) => c.org === orgId).length; org.drivers = drivers.filter((d) => d.org === orgId).length; }
}

function clearArr(a) { if (Array.isArray(a)) a.length = 0; }

async function connectBootstrap() {
  let me;
  try {
    const r = await apiGet("/api/admin/me");
    if (r.status === 401) return renderLogin();
    if (!r.ok) return renderLogin("Session error. Please sign in.");
    me = await r.json();
  } catch (e) { app.innerHTML = `<p style="padding:40px">Cannot reach the test API. ${esc(String(e))}</p>`; return; }
  IDENTITY = me;
  role = me.isPlatform ? "admin" : "cpo";

  // resolve org list
  let orgList = [];
  if (me.isPlatform) {
    const r = await apiGet("/api/admin/orgs");
    orgList = r.ok ? (await r.json()).orgs : [];
  } else {
    orgList = me.orgs.map((o) => ({ id: o.orgId, displayName: o.displayName, kind: o.kind, status: "active", roles: [], chargerCount: 0, driverCount: 0 }));
  }

  // reset every collection so nothing fake is shown
  clearArr(orgs); clearArr(sites); clearArr(chargers); clearArr(sessions); clearArr(installations);
  clearArr(drivers); clearArr(incidents); clearArr(audit); clearArr(contracts); clearArr(team); clearArr(groups);
  Object.keys(tariffBook).forEach((k) => delete tariffBook[k]);
  Object.keys(closedPeriods).forEach((k) => delete closedPeriods[k]);

  for (const o of orgList) {
    orgs.push({ id: o.id, name: o.displayName, type: (o.roles && o.roles.length ? o.roles.join(", ") : "CPO"), sites: 0, connectors: o.chargerCount || 0, drivers: o.driverCount || 0, status: cap(o.status || "active") });
    tariffBook[o.id] = { active: { ...tariff }, draft: null, scheduled: null, sites: "all", version: 1 }; // sample calculator only
  }
  for (const o of orgList) await loadOrg(o.id);

  // real tenancy scoping (replaces the 'nordur' demo hardcode)
  if (!me.isPlatform) {
    const myOrg = orgList[0] && orgList[0].id;
    contextOrg = () => myOrg;
    inScope = (org) => org === myOrg;
    selectedOrg = myOrg;
  }
  mayWrite = () => false; // read-only test API

  // block every write action before the app's own handlers see it (capture phase)
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-action]");
    if (!b) return;
    if (isWriteAction(b.dataset.action)) {
      e.preventDefault(); e.stopImmediatePropagation();
      try { toast("Read-only test build — writes are disabled."); } catch (_) {}
    }
  }, true);

  // wrap render to apply connected-mode chrome after every paint
  const _render = render;
  render = function () { _render.apply(this, arguments); try { postRender(); } catch (e) {} };

  if (!location.hash) location.hash = me.isPlatform ? "#/admin/overview" : "#/cpo/overview";
  navigate();
}

function postRender() {
  // relabel the demo badge, drop the persona toggle (identity is real now)
  document.querySelectorAll(".demo").forEach((el) => { el.textContent = "Connected · test data"; el.title = "Live reads from the isolated test database"; });
  const roleSel = document.getElementById("role"); if (roleSel) roleSel.remove();
  const who = IDENTITY ? (IDENTITY.email + (IDENTITY.isPlatform ? " · platform" : " · " + (IDENTITY.orgs[0] ? IDENTITY.orgs[0].displayName : ""))) : "";
  // one-time connected banner
  if (!document.getElementById("rtm-banner")) {
    const b = document.createElement("div");
    b.id = "rtm-banner";
    b.style.cssText = "position:sticky;top:0;z-index:50;background:var(--accent-bg);border-bottom:1px solid var(--line);color:var(--ink);font-size:12px;padding:7px 14px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between";
    b.innerHTML = `<span><strong>Connected test build.</strong> Live reads from the isolated test DB · <em>read-only (writes disabled)</em> · signed in as ${esc(who)}. Tariffs/billing/contracts/incidents & the whole-product tabs are not yet wired and show empty or sample states.</span><button id="rtm-logout" style="background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:3px 10px;cursor:pointer">Sign out</button>`;
    document.body.prepend(b);
    document.getElementById("rtm-logout").addEventListener("click", async () => { await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }); location.reload(); });
  }
}
