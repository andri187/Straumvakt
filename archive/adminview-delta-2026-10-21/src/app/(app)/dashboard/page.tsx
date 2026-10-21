// Dashboard page now renders the homepage concept from
// docs/app/homepage-concept.html.
//
// CSS is embedded verbatim from that file, with every selector scoped
// under .sv-home-concept to avoid leaking into the sidebar/topbar styles
// the rest of the (app) shell uses.
//
// The previous Sprint 3 closure dashboard is archived at
// docs/app/dashboard-original.tsx — copy back over this file to restore.

export const metadata = { title: "Dashboard" };

const conceptStyles = `
.sv-home-concept {
  --bg: #070b16;
  --surface: #0b1220;
  --raised: #111a2e;
  --inset: #0e1626;
  --border: #1e2a44;
  --ring: #2b3a5e;
  --text: #f5f7fa;
  --muted: #97a3b8;
  --soft: #c8d1e0;
  --green: #3ee9a7;
  --teal: #2bd3c9;
  --blue: #2bb6e8;
  --sky: #6fb8f0;
  --amber: #f4c95d;
  --red: #ff6b6b;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--text);
  background:
    radial-gradient(900px 500px at 78% -5%, rgba(43, 182, 232, .16), transparent 64%),
    radial-gradient(760px 440px at 0% 0%, rgba(62, 233, 167, .1), transparent 62%),
    var(--bg);
  min-height: 100vh;
}

.sv-home-concept *, .sv-home-concept *::before, .sv-home-concept *::after { box-sizing: border-box; }

.sv-home-concept a { color: inherit; text-decoration: none; }

.sv-home-concept .page { min-height: 100vh; }

.sv-home-concept .nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 clamp(14px, 3vw, 40px);
  border-bottom: 1px solid rgba(30, 42, 68, .75);
  background: rgba(7, 11, 22, .78);
  backdrop-filter: blur(16px);
}

.sv-home-concept .mark {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.sv-home-concept .logo {
  width: 34px;
  height: 34px;
  display: block;
  filter: drop-shadow(0 12px 28px rgba(43,182,232,.25));
}

.sv-home-concept .word { min-width: 0; }

.sv-home-concept .word strong {
  display: block;
  font-size: 17px;
  letter-spacing: -0.01em;
  background: linear-gradient(135deg, var(--green), var(--teal) 55%, var(--blue));
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  line-height: 1.1;
}

.sv-home-concept .word span {
  display: block;
  margin-top: 3px;
  color: var(--sky);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
  white-space: nowrap;
}

.sv-home-concept .navlinks {
  display: flex;
  gap: 22px;
  align-items: center;
  color: var(--soft);
  font-size: 13px;
}

.sv-home-concept .navlinks a:hover { color: var(--text); }

.sv-home-concept .hero {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: clamp(20px, 3vw, 48px);
  align-items: center;
  padding: clamp(24px, 4vw, 56px) clamp(14px, 3vw, 40px) 40px;
}

.sv-home-concept .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid rgba(111, 184, 240, .28);
  border-radius: 7px;
  color: var(--sky);
  background: rgba(17, 26, 46, .64);
  font-size: 12px;
  font-weight: 700;
}

.sv-home-concept .eyebrow i {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 16px var(--green);
}

.sv-home-concept h1 {
  max-width: 780px;
  margin: 16px 0 0;
  font-size: clamp(28px, 4.4vw, 64px);
  line-height: 1;
  letter-spacing: 0;
}

.sv-home-concept .lead {
  max-width: 640px;
  margin: 18px 0 0;
  color: var(--soft);
  font-size: clamp(14px, 1.4vw, 19px);
  line-height: 1.55;
}

.sv-home-concept .lead strong { color: var(--text); font-weight: 750; }

.sv-home-concept .buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
}

.sv-home-concept .button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 800;
  border: 1px solid var(--ring);
  background: var(--raised);
  color: var(--text);
}

.sv-home-concept .button.primary {
  color: #06131a;
  background: linear-gradient(135deg, var(--green), var(--teal) 55%, var(--blue));
  border-color: transparent;
}

.sv-home-concept .plain-note {
  margin-top: 26px;
  display: grid;
  gap: 8px;
  max-width: 610px;
}

.sv-home-concept .plain-note p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

.sv-home-concept .plain-note b { color: var(--sky); }

.sv-home-concept .visual {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(43, 58, 94, .85);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(17, 26, 46, .94), rgba(11, 18, 32, .94)),
    repeating-linear-gradient(0deg, transparent 0 31px, rgba(255,255,255,.035) 32px),
    repeating-linear-gradient(90deg, transparent 0 31px, rgba(255,255,255,.035) 32px);
  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 24px 70px rgba(0,0,0,.36);
  overflow: hidden;
  container-type: inline-size;
}

.sv-home-concept .visual-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(43, 58, 94, .8);
  background: rgba(7, 11, 22, .45);
}

.sv-home-concept .visual-header strong {
  font-size: 13px;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.sv-home-concept .status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--green);
  font-size: 12px;
  font-weight: 800;
}

.sv-home-concept .status i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 18px currentColor;
}

.sv-home-concept .map {
  position: relative;
  aspect-ratio: 610 / 430;
  margin: clamp(12px, 2.4cqi, 28px);
  flex: 1 1 auto;
}

.sv-home-concept .node {
  position: absolute;
  width: clamp(120px, 25cqi, 168px);
  padding: clamp(7px, 1.4cqi, 11px) clamp(8px, 1.6cqi, 12px);
  border: 1px solid rgba(111, 184, 240, .34);
  border-radius: 8px;
  background: rgba(7, 11, 22, .86);
  box-shadow: 0 12px 28px rgba(0,0,0,.2);
}

.sv-home-concept .node small {
  display: block;
  color: var(--muted);
  font-size: clamp(9px, 1.4cqi, 11px);
  line-height: 1.25;
}

.sv-home-concept .node strong {
  display: block;
  margin-top: 3px;
  font-size: clamp(11px, 1.8cqi, 15px);
  line-height: 1.2;
}

.sv-home-concept .node .mini {
  display: flex;
  gap: 5px;
  margin-top: 9px;
}

.sv-home-concept .mini span {
  height: 6px;
  flex: 1;
  border-radius: 999px;
  background: rgba(151,163,184,.2);
}

.sv-home-concept .mini span.on { background: linear-gradient(90deg, var(--green), var(--blue)); }

.sv-home-concept .org { left: 2.6%; top: 13.5%; }
.sv-home-concept .site { left: 35.1%; top: 13.5%; }
.sv-home-concept .install { left: 67.5%; top: 13.5%; }
.sv-home-concept .station { left: 67.5%; top: 46%; }
.sv-home-concept .ocpp { left: 35.1%; top: 65.1%; }
.sv-home-concept .vendor { left: 2.6%; top: 65.1%; }

.sv-home-concept svg.lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.sv-home-concept .line {
  fill: none;
  stroke: rgba(111, 184, 240, .42);
  stroke-width: 2;
}

.sv-home-concept .line.hot {
  stroke: url(#sv-flow);
  stroke-width: 3;
  stroke-dasharray: 10 8;
  animation: sv-dash 1.7s linear infinite;
}

@keyframes sv-dash { to { stroke-dashoffset: -36; } }

.sv-home-concept .caption-card {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 0 clamp(12px, 2.4cqi, 28px) clamp(12px, 2.4cqi, 24px);
}

.sv-home-concept .caption {
  padding: clamp(10px, 1.6cqi, 13px);
  border: 1px solid rgba(43, 58, 94, .9);
  border-radius: 8px;
  background: rgba(14, 22, 38, .92);
}

.sv-home-concept .caption strong {
  display: block;
  margin-bottom: 6px;
  font-size: clamp(11px, 1.5cqi, 13px);
}

.sv-home-concept .caption p {
  margin: 0;
  color: var(--muted);
  font-size: clamp(10px, 1.4cqi, 12px);
  line-height: 1.42;
}

.sv-home-concept .band {
  padding: 16px clamp(14px, 3vw, 40px) clamp(40px, 5vw, 64px);
}

.sv-home-concept .section-head {
  max-width: 780px;
  margin-bottom: 18px;
}

.sv-home-concept .section-head h2 {
  margin: 0;
  font-size: clamp(20px, 2.4vw, 36px);
  letter-spacing: 0;
}

.sv-home-concept .section-head p {
  margin: 8px 0 0;
  color: var(--soft);
  font-size: clamp(13px, 1.2vw, 15px);
  line-height: 1.55;
}

.sv-home-concept .cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.sv-home-concept .info {
  padding: clamp(14px, 1.6vw, 18px);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(11, 18, 32, .74);
  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 12px 30px rgba(0,0,0,.18);
}

.sv-home-concept .icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-bottom: 12px;
  border-radius: 8px;
  color: #06131a;
  background: linear-gradient(135deg, var(--green), var(--blue));
  font-weight: 900;
  font-size: 14px;
}

.sv-home-concept .info h3 { margin: 0; font-size: clamp(14px, 1.2vw, 16px); }

.sv-home-concept .info p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: clamp(12px, 1vw, 14px);
  line-height: 1.55;
}

@media (max-width: 1100px) {
  .sv-home-concept .hero { grid-template-columns: 1fr; }
  .sv-home-concept .visual { max-width: 720px; }
  .sv-home-concept .navlinks { display: none; }
}

@media (max-width: 720px) {
  .sv-home-concept .caption-card { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .sv-home-concept .visual { display: none; }
  .sv-home-concept .hero { padding-top: 20px; }
}
`;

export default function DashboardPage() {
  return (
    <div className="sv-home-concept">
      <style dangerouslySetInnerHTML={{ __html: conceptStyles }} />
      <div className="page">
        <nav className="nav">
          <a className="mark" href="#">
            <svg className="logo" viewBox="0 0 120 120" fill="none" aria-hidden="true">
              <defs>
                <linearGradient
                  id="svHomeBolt"
                  x1="40"
                  y1="20"
                  x2="80"
                  y2="100"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#8EF5C7" />
                  <stop offset="100%" stopColor="#6FDCEA" />
                </linearGradient>
              </defs>
              <path
                d="M 84 18 L 54 18 A 24 24 0 0 0 30 42 L 30 60"
                stroke="#3EE9A7"
                strokeWidth="13"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M 36 102 L 66 102 A 24 24 0 0 0 90 78 L 90 60"
                stroke="#2BB6E8"
                strokeWidth="13"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z"
                fill="url(#svHomeBolt)"
              />
            </svg>
            <span className="word">
              <strong>Straumvakt</strong>
              <span>Control · Overview · Convenience</span>
            </span>
          </a>
          <div className="navlinks">
            <a href="#what">What it is</a>
            <a href="#how">How it works</a>
            <a href="#why">Why it matters</a>
          </div>
        </nav>

        <section className="hero" id="what">
          <div>
            <span className="eyebrow">
              <i></i> Charging operating platform for real sites
            </span>
            <h1>One place to run chargers, people, power, and billing.</h1>
            <p className="lead">
              Straumvakt helps operators understand and manage EV charging
              sites. It keeps the <strong>physical reality</strong> clear:
              properties, sites, installations, circuits, chargers, meters,
              modems, controllers, drivers, sessions, and costs.
            </p>
            <div className="buttons">
              <a className="button primary" href="#how">
                See the simple map
              </a>
              <a className="button" href="#why">
                Read the plain explanation
              </a>
            </div>
            <div className="plain-note">
              <p>
                <b>Not just OCPP.</b> Straumvakt can work through OCPP, vendor
                APIs like Zaptec and Easee, external CPMS imports, or read-only
                data.
              </p>
              <p>
                <b>Not just a dashboard.</b> It is the operating layer that
                connects assets, contracts, events, issues, and billing.
              </p>
            </div>
          </div>

          <div className="visual" aria-label="Straumvakt operating map">
            <div className="visual-header">
              <strong>Live operating map</strong>
              <span className="status">
                <i></i> domain events flowing
              </span>
            </div>
            <div className="map">
              <svg className="lines" viewBox="0 0 610 430" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sv-flow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3ee9a7" />
                    <stop offset="58%" stopColor="#2bd3c9" />
                    <stop offset="100%" stopColor="#2bb6e8" />
                  </linearGradient>
                </defs>
                <path className="line hot" d="M158 92 H214" />
                <path className="line hot" d="M356 92 H412" />
                <path className="line" d="M484 132 V198" />
                <path className="line hot" d="M412 238 H356 C300 238 286 280 286 280" />
                <path className="line" d="M214 320 H158" />
                <path className="line hot" d="M86 280 C86 212 178 190 214 132" />
              </svg>

              <div className="node org">
                <small>Legal entity</small>
                <strong>Operator / owner / payer</strong>
                <div className="mini">
                  <span className="on"></span>
                  <span className="on"></span>
                  <span></span>
                </div>
              </div>
              <div className="node site">
                <small>Physical place</small>
                <strong>Property and site</strong>
                <div className="mini">
                  <span className="on"></span>
                  <span className="on"></span>
                  <span className="on"></span>
                </div>
              </div>
              <div className="node install">
                <small>Electrical grouping</small>
                <strong>Installation and circuits</strong>
                <div className="mini">
                  <span className="on"></span>
                  <span className="on"></span>
                  <span></span>
                </div>
              </div>
              <div className="node station">
                <small>Physical assets</small>
                <strong>Chargers, meters, modems</strong>
                <div className="mini">
                  <span className="on"></span>
                  <span></span>
                  <span className="on"></span>
                </div>
              </div>
              <div className="node ocpp">
                <small>Control plane</small>
                <strong>OCPP / vendor / CPMS</strong>
                <div className="mini">
                  <span className="on"></span>
                  <span className="on"></span>
                  <span className="on"></span>
                </div>
              </div>
              <div className="node vendor">
                <small>Source of truth</small>
                <strong>Events and billing</strong>
                <div className="mini">
                  <span className="on"></span>
                  <span className="on"></span>
                  <span className="on"></span>
                </div>
              </div>
            </div>

            <div className="caption-card">
              <div className="caption">
                <strong>See the site clearly</strong>
                <p>
                  From organization down to every circuit, charger, meter,
                  modem, and controller.
                </p>
              </div>
              <div className="caption">
                <strong>Use any control path</strong>
                <p>
                  Native OCPP, Zaptec/Easee APIs, external CPMS, or read-only
                  imports.
                </p>
              </div>
              <div className="caption">
                <strong>Keep one event truth</strong>
                <p>
                  Sessions, faults, commands, and meter values become canonical
                  events.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="band" id="how">
          <div className="section-head">
            <h2>In plain terms</h2>
            <p>
              Straumvakt is the layer between messy field reality and daily
              operations. It helps people answer simple questions quickly.
            </p>
          </div>
          <div className="cards">
            <article className="info">
              <div className="icon">1</div>
              <h3>What do we own or operate?</h3>
              <p>
                Organizations, properties, sites, installations, circuits,
                chargers, connectors, meters, modems, and controllers are
                modeled as real physical things.
              </p>
            </article>
            <article className="info">
              <div className="icon">2</div>
              <h3>How are chargers controlled?</h3>
              <p>
                Each asset can be controlled through the right path: OCPP, OEM
                API, an external CPMS, or no control at all when the site is
                read-only.
              </p>
            </article>
            <article className="info">
              <div className="icon">3</div>
              <h3>What happened?</h3>
              <p>
                Every command, status change, session, fault, and meter reading
                is preserved as an event so reports and audits have a common
                foundation.
              </p>
            </article>
            <article className="info">
              <div className="icon">4</div>
              <h3>Who pays for what?</h3>
              <p>
                Contracts, tariffs, cost centers, drivers, workplaces, owners,
                and service fees are tied back to sessions and physical assets.
              </p>
            </article>
          </div>
        </section>

        <section className="band" id="why">
          <div className="section-head">
            <h2>Built for operators, technicians, and finance</h2>
            <p>
              The goal is not to force every charger into one protocol. The
              goal is to make a charging operation understandable, supportable,
              and billable even when different vendors and control systems are
              involved.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
