const fake = {
  metrics: [
    ["Chargers online", "26 / 28", "+3 since yesterday"],
    ["Active sessions", "7", "42.6 kWh in progress"],
    ["Open issues", "5", "2 require operator action"],
    ["April review", "218,460 kr", "Read-only billing dashboard"],
  ],
  chargers: [
    ["N1 Hringbraut", "Installation 1 · Charger 02 · 0.4 km", "Ready"],
    ["Austurvollur P2", "Installation 1 · Charger 05 · 1.1 km", "Charging"],
    ["Fleet Depot North", "Installation 2 · Charger 14 · 2.3 km", "Ready"],
    ["N1 Akureyri", "Installation 2 · Charger 19 · 4.8 km", "Faulted"],
  ],
  sessions: [
    ["Alex Driver", "N1 Hringbraut · 18.2 kWh · 1,240 kr", "Charging"],
    ["Sara Jóns", "Austurvollur P2 · 7.8 kWh · 538 kr", "Completed"],
    ["Mikael K.", "Fleet Depot North · 22.4 kWh · 1,546 kr", "Completed"],
    ["Helga R.", "N1 Akureyri · start failed", "Issue"],
  ],
  issues: [
    ["Connector lock delay", "N1 Hringbraut · opened by driver app", "Open"],
    ["Repeated faulted status", "N1 Akureyri · rule: faulted twice in 1h", "Open"],
    ["Heartbeat delay", "Fleet Depot North · recovered after 4 min", "Resolved"],
    ["Meter value anomaly", "Austurvollur P2 · non-monotonic sample", "Triaged"],
  ],
  billing: [
    ["Alex Driver", "42.7 kWh", "2,656 kr", "Ready for review"],
    ["Sara Jóns", "28.4 kWh", "1,822 kr", "Ready for review"],
    ["Mikael K.", "61.9 kWh", "4,120 kr", "Host covered"],
    ["Family group A-104", "96.2 kWh", "6,284 kr", "Rollup"],
  ],
  roadmap: [
    ["Sprint -1", "Login Shell", "Done", "Admin login, session handling, shell wiring", "Operator surface"],
    ["Sprint 0", "Foundation Schema", "Done", "V3 schemas, event log, repositories, catalog seed", "Domain model"],
    ["Sprint 1", "OCPP Foundation", "Done 1.5", "Ingest, translator, outbox, gateway, control-plane test", "Chargers online"],
    ["Sprint 2", "OCPI Foundation", "Next", "CPO endpoints, RFID authorize, contract tests", "Roaming surface"],
    ["Sprint 3", "Driver Experience", "Future", "Password login, PWA, session history, family group", "Drivers charge"],
    ["Sprint 4", "Commercial Model", "Future", "Plans, tariff engine, ISK cost calculation", "Pricing logic"],
    ["Sprint 5", "Issue Engine + Console", "Future", "Five rules, workflow, console pages", "Operator workflow"],
    ["Sprint 6", "Billing Dashboard", "Future", "Reviewable per-driver and per-Host totals", "Pilot billing insight"],
  ],
};

const titles = {
  overview: "Overview",
  chargers: "Chargers",
  sessions: "Sessions",
  issues: "Issues",
  billing: "Billing",
  roadmap: "Roadmap",
};

const app = document.querySelector("#app");
const title = document.querySelector("#view-title");
const navItems = [...document.querySelectorAll(".nav-item")];
const viewButtons = [...document.querySelectorAll("[data-view]")];
const treeToggles = [...document.querySelectorAll("[data-tree-toggle]")];
const treeScopedItems = [...document.querySelectorAll("[data-tree-scope]")];
const treePrimaryAction = document.querySelector("#tree-primary-action");
const treeSecondaryAction = document.querySelector("#tree-secondary-action");
const treeTertiaryAction = document.querySelector("#tree-tertiary-action");
const treeContextLabel = document.querySelector("#tree-context-label");
const roleItems = [...document.querySelectorAll(".role-emblem")];
const roleLabel = document.querySelector("#role-label");

const treeActions = {
  sites: ["Sites", "Add site", "Import", "Filter"],
  site: ["Selected site", "Add install", "Site details", "Members"],
  installation: ["Selected installation", "Add charger", "Provision", "Commands"],
  charger: ["Selected charger", "Open charger", "Start test", "Create issue"],
};

function statusClass(value) {
  const key = value.toLowerCase();
  if (key.includes("done") || key.includes("completed") || key.includes("resolved")) return "done";
  if (key.includes("next") || key.includes("charging") || key.includes("triaged")) return "next";
  if (key.includes("fault") || key.includes("open") || key.includes("issue")) return "open";
  return "ready";
}

function metricCards() {
  return `<section class="grid cols-4">${fake.metrics
    .map(
      ([label, value, note]) => `
        <article class="card metric">
          <span>${label}</span>
          <strong>${value}</strong>
          <small>${note}</small>
        </article>`,
    )
    .join("")}</section>`;
}

function listCard(label, rows) {
  return `
    <article class="card">
      <div class="card-header">
        <h2>${label}</h2>
        <span class="pill">Fake live data</span>
      </div>
      <div class="list">
        ${rows
          .map(
            ([name, sub, status]) => `
              <div class="row">
                <div>
                  <div class="row-title">${name}</div>
                  <div class="row-sub">${sub}</div>
                </div>
                <span class="status ${statusClass(status)}">${status}</span>
              </div>`,
          )
          .join("")}
      </div>
    </article>`;
}

function overview() {
  app.innerHTML = `
    ${metricCards()}
    <section class="grid cols-2">
      ${listCard("Live charger state", fake.chargers)}
      <article class="card">
        <div class="card-header">
          <h2>Pilot readiness</h2>
          <span class="pill">Sprint 2 next</span>
        </div>
        <div class="list">
          ${[
            ["OCPP control plane", 100],
            ["CPO OCPI surface", 18],
            ["Driver PWA shell", 34],
            ["Issue Engine v1", 22],
          ]
            .map(
              ([name, percent]) => `
              <div class="row">
                <div>
                  <div class="row-title">${name}</div>
                  <div class="row-sub">
                    <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
                  </div>
                </div>
                <span class="pill">${percent}%</span>
              </div>`,
            )
            .join("")}
        </div>
      </article>
    </section>`;
}

function table(headers, rows, cls = "") {
  return `
    <article class="table-card ${cls}">
      <table>
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>${row
                .map((cell, index) =>
                  index === 2 || (headers.length === 3 && index === 2)
                    ? `<td><span class="status ${statusClass(cell)}">${cell}</span></td>`
                    : `<td>${cell}</td>`,
                )
                .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </article>`;
}

function setView(view) {
  title.textContent = titles[view];
  viewButtons.forEach((item) => item.classList.toggle("active", item.dataset.view === view));

  if (view === "overview") overview();
  if (view === "chargers") {
    app.innerHTML = `${metricCards()}${table(["Charger", "Context", "Status"], fake.chargers)}`;
  }
  if (view === "sessions") {
    app.innerHTML = `${listCard("Live and recent sessions", fake.sessions)}${table(["Driver", "Session", "State"], fake.sessions)}`;
  }
  if (view === "issues") {
    app.innerHTML = `${listCard("Issue queue", fake.issues)}${table(["Issue", "Source", "State"], fake.issues)}`;
  }
  if (view === "billing") {
    app.innerHTML = `${metricCards()}${table(["Account", "Energy", "Amount", "Review state"], fake.billing)}`;
  }
  if (view === "roadmap") {
    app.innerHTML = table(["Sprint", "Roadmap Area", "Status", "Roadmap Detail", "Unlocks"], fake.roadmap, "roadmap");
  }
}

function setTreeScope(scope) {
  const actions = treeActions[scope] || treeActions.sites;
  treeContextLabel.textContent = actions[0];
  treePrimaryAction.textContent = actions[1];
  treeSecondaryAction.textContent = actions[2];
  treeTertiaryAction.textContent = actions[3];
}

viewButtons.forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
treeScopedItems.forEach((item) => {
  item.addEventListener("click", () => setTreeScope(item.dataset.treeScope));
});
treeToggles.forEach((item) => {
  item.addEventListener("click", () => {
    const target = document.getElementById(item.dataset.treeToggle);
    if (!target) return;

    const shouldExpand = item.getAttribute("aria-expanded") !== "true";
    item.setAttribute("aria-expanded", String(shouldExpand));
    target.classList.toggle("collapsed", !shouldExpand);
  });
});
roleItems.forEach((item) => {
  item.addEventListener("click", () => {
    roleItems.forEach((role) => role.classList.toggle("active", role === item));
    roleLabel.textContent = item.dataset.role;
  });
});
setView("overview");

function enableDevAutoRefresh() {
  if (!["127.0.0.1", "localhost"].includes(window.location.hostname)) return;

  const watchedFiles = ["index.html", "styles.css", "app.js"];
  const lastModified = new Map();

  async function checkFile(file) {
    const response = await fetch(`${file}?v=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
    });
    const stamp = response.headers.get("last-modified") || "";

    if (!lastModified.has(file)) {
      lastModified.set(file, stamp);
      return false;
    }

    if (lastModified.get(file) !== stamp) {
      return true;
    }

    return false;
  }

  setInterval(async () => {
    try {
      const changed = await Promise.all(watchedFiles.map(checkFile));
      if (changed.some(Boolean)) window.location.reload();
    } catch {
      // The local static server may be restarting; the next poll will retry.
    }
  }, 900);
}

enableDevAutoRefresh();
