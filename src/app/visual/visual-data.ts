export type Tone = "good" | "warn" | "bad" | "info" | "neutral";
export type Metric = { label: string; value: string; detail: string; tone?: Tone };
export type VisualScreen = {
  id: string; label: string; eyebrow: string; title: string; summary: string;
  state: string; stateTone: Tone; metrics: Metric[]; tableTitle: string;
  columns: string[]; rows: string[][]; queueTitle: string;
  queue: { title: string; detail: string; tone: Tone }[];
  notice?: string; action?: string; actionDisabled?: boolean;
};
export type VisualFamily = {
  id: "admin" | "organisation" | "driver" | "service"; label: string;
  shortLabel: string; role: string; account: string; future?: boolean;
  accent: string; navigationAbsent: string; screens: VisualScreen[];
};

const m = (label: string, value: string, detail: string, tone: Tone = "neutral"): Metric => ({ label, value, detail, tone });
const q = (title: string, detail: string, tone: Tone) => ({ title, detail, tone });

const adminBase = {
  columns: ["Priority", "Context", "Signal", "Owner", "Age"],
  rows: [
    ["Urgent", "DEMO-ZP-074002", "Repeated reboot", "Platform", "18 min"],
    ["High", "Demo Harbour", "Offline charger", "Support", "43 min"],
    ["Review", "Demo Housing 12", "Terms incomplete", "Commercial", "2 h"],
  ],
  queue: [q("Review Demo Harbour", "Technical setup needs an owner", "warn"), q("Resolve unknown charger", "Serial DEMO-8841", "bad"), q("Confirm beta evidence", "12 of 14 checks complete", "info")],
};
const cpoBase = {
  columns: ["Identity", "Site", "State", "Observed", "Next action"],
  rows: [
    ["DEMO-ZP-001", "Main office", "Charging", "22.1 kW", "Monitor"],
    ["DEMO-ZP-007", "Warehouse", "Offline", "Unavailable", "Review case"],
    ["DEMO-EA-004", "Harbour depot", "Available", "0.0 kW", "None"],
  ],
  queue: [q("Warehouse charger 07", "Offline for 43 minutes", "bad"), q("Three access requests", "Waiting for organisation decision", "warn"), q("Cost factor review", "Future effective date", "info")],
};
const driverBase = {
  columns: ["Place", "State", "Energy", "Cost", "When"],
  rows: [
    ["Main office 02", "Charging", "18.4 kWh", "Pending", "Now"],
    ["Warehouse 01", "Settled", "42.8 kWh", "2,184 kr", "07 Aug"],
    ["Main office 01", "Settled", "12.1 kWh", "327 kr", "05 Aug"],
  ],
  queue: [q("Identity-bound invitation", "Codes cannot reset your password", "good"), q("Plug-time terms", "1 kr/min after 4 hours", "warn"), q("Missing telemetry", "Shown as unavailable, never zero", "info")],
};
const serviceBase = {
  columns: ["Case", "Asset", "Site", "Priority", "Window"],
  rows: [
    ["SV-2041", "DEMO-ZP-074002", "Main office", "Urgent", "14:30–15:30"],
    ["SV-2038", "DEMO-EA-004", "Harbour", "High", "16:00–17:00"],
    ["SV-2029", "DEMO-ZP-019", "Warehouse", "Routine", "Tomorrow"],
  ],
  queue: [q("Confirm isolation owner", "Hard stop before enclosure access", "bad"), q("Preserve original evidence", "Edits create a derivative", "warn"), q("Assignment expires", "Access ends with the case", "good")],
};

const screen = (
  base: typeof adminBase,
  value: Omit<VisualScreen, "columns" | "rows" | "queue"> & Partial<Pick<VisualScreen, "columns" | "rows" | "queue">>,
): VisualScreen => ({ ...base, ...value });

export const visualFamilies: VisualFamily[] = [
  {
    id: "admin", label: "Straumvakt Admin", shortLabel: "Admin", role: "Platform operations", account: "demo-staff@straumvakt.test", accent: "mint",
    navigationAbsent: "No billing mutation, impersonation, cloud controls or repository-health UI.",
    screens: [
      screen(adminBase, { id: "overview", label: "Operations overview", eyebrow: "Today · 09 August", title: "Morning control room", summary: "Organisations, fleet health and work that needs a human decision.", state: "Beta view", stateTone: "info", metrics: [m("Organisations", "18", "16 active", "good"), m("Connectors", "4,086", "97.8% reporting", "good"), m("Active sessions", "126", "38.4 MW observed", "info"), m("Needs attention", "14", "3 urgent", "warn")], tableTitle: "Fleet exceptions", queueTitle: "Staff queue", action: "Open task queue" }),
      screen(adminBase, { id: "organisations", label: "Organisations", eyebrow: "Portfolio", title: "Organisations and onboarding", summary: "Follow each organisation from application to operating tenant.", state: "3 onboarding", stateTone: "warn", metrics: [m("Operating", "16", "Across 42 sites", "good"), m("Onboarding", "3", "2 waiting on customer", "warn"), m("Suspended", "1", "Commercial review", "bad"), m("Median setup", "4.2 d", "Down 1.1 days", "good")], tableTitle: "Organisation register", queueTitle: "Onboarding handoffs", action: "Review application" }),
      screen(adminBase, { id: "fleet", label: "Fleet oversight", eyebrow: "4,086 connectors", title: "Cross-operator fleet", summary: "Find systemic problems without becoming a charger configuration console.", state: "97.8% online", stateTone: "good", metrics: [m("Online", "3,996", "Last 5 minutes", "good"), m("Charging", "612", "15% utilisation", "info"), m("Offline", "71", "22 over 30 min", "warn"), m("Faulted", "19", "7 assigned", "bad")], tableTitle: "Priority assets", queueTitle: "Fleet signals", action: "Export view" }),
      screen(adminBase, { id: "support", label: "Support context", eyebrow: "Attributed assistance", title: "Organisation support", summary: "Enter an explicit, expiring context while preserving actor and tenant.", state: "Concept only", stateTone: "warn", metrics: [m("Open cases", "9", "2 priority", "warn"), m("Contexts active", "0", "Persistence not wired"), m("Median response", "11 min", "Target met", "good"), m("Escalations", "2", "Both assigned", "info")], tableTitle: "Support cases", queueTitle: "Support boundary", notice: "Assistance is not impersonation. Persistence and audit reads are not wired.", action: "Enter support context", actionDisabled: true }),
      screen(adminBase, { id: "risks", label: "Unresolved risks", eyebrow: "Launch controls", title: "Risks requiring ownership", summary: "Separate launch blockers, beta debt and field unknowns.", state: "3 launch blockers", stateTone: "bad", metrics: [m("Launch blockers", "3", "Decision required", "bad"), m("Beta risks", "8", "4 mitigated", "warn"), m("Field unknowns", "6", "Bench evidence", "info"), m("Past due", "2", "Owners notified", "bad")], tableTitle: "Risk register", queueTitle: "Decision queue", action: "Open decision packet" }),
      screen(adminBase, { id: "activity", label: "Audit and activity", eyebrow: "Evidence boundary", title: "Platform activity", summary: "Distinguish product events from security audit evidence.", state: "Read missing", stateTone: "warn", metrics: [m("Product events", "—", "Aggregate unavailable"), m("Audit events", "—", "Canonical read missing"), m("Retention", "Undecided", "Legal input", "warn"), m("Exports", "Disabled", "No contract")], tableTitle: "Example event shape", queueTitle: "Before wiring", notice: "Demo rows show information architecture only.", action: "Export audit", actionDisabled: true }),
      screen(adminBase, { id: "readiness", label: "Beta readiness", eyebrow: "Release evidence", title: "Beta gate", summary: "Product evidence, ownership and stop conditions without repository internals.", state: "12 of 14", stateTone: "warn", metrics: [m("Product", "7/8", "Cost rehearsal open", "warn"), m("Operations", "3/3", "Runbooks assigned", "good"), m("Security", "2/3", "Rate limit open", "bad"), m("Hardware", "0/1", "Supervised test", "warn")], tableTitle: "Release evidence", queueTitle: "Before beta", action: "Print rehearsal" }),
      screen(adminBase, { id: "tasks", label: "Staff task queue", eyebrow: "Assigned work", title: "My platform tasks", summary: "Order work by consequence, age and next action, not notification volume.", state: "8 open", stateTone: "info", metrics: [m("Mine", "8", "3 due today", "warn"), m("Team", "24", "5 unassigned", "info"), m("Waiting", "11", "Customer or vendor"), m("Completed", "17", "This week", "good")], tableTitle: "Assigned to me", queueTitle: "Unassigned", action: "Take next task" }),
    ],
  },
  {
    id: "organisation", label: "Organisation / CPO", shortLabel: "CPO", role: "Demo North Energy", account: "ops@north.test", accent: "cyan",
    navigationAbsent: "No platform risks, cross-tenant data, Worker controls or staff support entry.",
    screens: [
      screen(cpoBase, { id: "overview", label: "Overview", eyebrow: "Demo North Energy", title: "Charging operations", summary: "The weekly picture for sites, chargers, drivers and live charging.", state: "Operating", stateTone: "good", metrics: [m("Chargers", "24", "22 online", "good"), m("Active sessions", "8", "164 kW", "info"), m("Drivers", "146", "3 requests", "warn"), m("Energy today", "1.84 MWh", "+18% weekday", "good")], tableTitle: "Site performance", queueTitle: "Needs attention", action: "View chargers" }),
      screen(cpoBase, { id: "chargers", label: "Chargers", eyebrow: "24 chargers", title: "Charger inventory", summary: "Scan state quickly, then enter one asset without losing site context.", state: "2 exceptions", stateTone: "warn", metrics: [m("Online", "22", "91.7%", "good"), m("Charging", "8", "164 kW", "info"), m("Offline", "2", "Both assigned", "warn"), m("Available", "14", "Across 3 sites")], tableTitle: "Inventory", queueTitle: "Inventory actions", action: "Add charger" }),
      screen(cpoBase, { id: "sites", label: "Sites and installations", eyebrow: "3 sites · 5 installations", title: "Places and electrical groups", summary: "Separate customer places from technical charger installations.", state: "All mapped", stateTone: "good", metrics: [m("Sites", "3", "Customer-facing"), m("Installations", "5", "Electrical groups"), m("Capacity", "1.2 MW", "Contracted"), m("Peak", "486 kW", "40.5%", "good")], tableTitle: "Site structure", queueTitle: "Site notes", action: "Add installation", actionDisabled: true }),
      screen(cpoBase, { id: "drivers", label: "Drivers", eyebrow: "146 active", title: "People with charging access", summary: "Find membership, group and access without exposing national IDs.", state: "3 requests", stateTone: "warn", metrics: [m("Active", "146", "4 groups", "good"), m("Pending", "3", "Oldest 2 h", "warn"), m("Dormant", "11", "90 days"), m("Tokens", "158", "12 technical", "info")], tableTitle: "Driver roster", queueTitle: "Driver actions", action: "Review requests" }),
      screen(cpoBase, { id: "access", label: "Access requests", eyebrow: "Organisation decisions", title: "Access request queue", summary: "Approve or deny a specific scope with a visible reason.", state: "3 pending", stateTone: "warn", metrics: [m("Pending", "3", "Oldest 2 h", "warn"), m("Approved", "18", "This month", "good"), m("Denied", "2", "Reasons recorded"), m("Decision", "26 min", "Median", "good")], tableTitle: "Requests", queueTitle: "Decision principles", action: "Review oldest" }),
      screen(cpoBase, { id: "sessions", label: "Sessions", eyebrow: "Live and completed", title: "Charging sessions", summary: "Records with explicit provisional values and no invented telemetry.", state: "8 active", stateTone: "info", metrics: [m("Active", "8", "Across 2 sites", "info"), m("Energy", "1.84 MWh", "Today", "good"), m("Current cost", "Pending", "Projection"), m("Exceptions", "1", "Meter gap", "warn")], tableTitle: "Recent sessions", queueTitle: "Session integrity", action: "Export sessions" }),
      screen(cpoBase, { id: "agreements", label: "Agreements and cost", eyebrow: "Commercial read", title: "Agreements and cost factors", summary: "Read commercial structure while assignment mutations remain unavailable.", state: "Read only", stateTone: "info", metrics: [m("Agreements", "2", "Current", "good"), m("Driver groups", "4", "Visible"), m("Cost factors", "6", "Catalogue"), m("Changes", "1", "Future date", "warn")], tableTitle: "Current agreements", queueTitle: "Commercial boundaries", notice: "Cost-factor assignment remains disabled.", action: "Assign cost factor", actionDisabled: true }),
      screen(cpoBase, { id: "settings", label: "Settings", eyebrow: "Organisation profile", title: "Operating settings", summary: "Stable organisation details without platform administration.", state: "2 incomplete", stateTone: "warn", metrics: [m("Profile", "Complete", "Legal identity", "good"), m("Contacts", "3", "Operations + billing"), m("Notifications", "5 rules", "2 channels"), m("Policies", "2 incomplete", "Backend needed", "warn")], tableTitle: "Settings register", queueTitle: "Settings boundaries", action: "Edit profile" }),
      screen(cpoBase, { id: "onboarding", label: "Onboarding and invites", eyebrow: "Security boundary", title: "Invite workflows unavailable", summary: "Explain why unsafe bearer invitation is withheld.", state: "Blocked for safety", stateTone: "bad", metrics: [m("Safe path", "Identity bound", "Driver redeem", "good"), m("Bearer path", "Withheld", "Overwrite risk", "bad"), m("Open invites", "—", "Read missing"), m("Access codes", "Future", "Contracts needed")], tableTitle: "Required replacement", queueTitle: "Before enabling", notice: "No demo action submits or implies a real invitation.", action: "Create invitation", actionDisabled: true }),
    ],
  },
  {
    id: "driver", label: "Driver", shortLabel: "Driver", role: "Personal charging", account: "demo-driver@straumvakt.test", accent: "blue",
    navigationAbsent: "No organisation management, charger configuration, raw meter payloads or diagnostics.",
    screens: [
      screen(driverBase, { id: "guest", label: "Guest", eyebrow: "No account", title: "Charging starts with access", summary: "Explain what an account does without claiming a relationship exists.", state: "Local state", stateTone: "info", metrics: [m("Account", "None", "Nothing stored"), m("Access", "None", "Organisation needed"), m("Sessions", "None", "No history"), m("Privacy", "Local", "No driver data", "good")], tableTitle: "What happens next", queueTitle: "Guest promises", action: "Sign in" }),
      screen(driverBase, { id: "no-access", label: "No access yet", eyebrow: "Registered driver", title: "You are ready; access is next", summary: "Refresh, use an identity-bound invitation or request access.", state: "Unaffiliated", stateTone: "warn", metrics: [m("Identity", "Ready", "demo-driver", "good"), m("Organisations", "0", "No membership"), m("Requests", "1", "Draft", "warn"), m("Sessions", "0", "No access")], tableTitle: "Ways to join", queueTitle: "Your current state", action: "Use invitation" }),
      screen(driverBase, { id: "access", label: "Invite and access", eyebrow: "Identity-bound", title: "Join an organisation", summary: "One route for invitations, pending approval and recoverable outcomes.", state: "Demo workflow", stateTone: "info", metrics: [m("Invite", "DEMO-7Q4K", "Reserved", "info"), m("Identity", "Matched", ".test account", "good"), m("Approval", "Pending", "Org policy", "warn"), m("Access", "Not active", "No claim")], tableTitle: "Access timeline", queueTitle: "What to expect", action: "Submit request", actionDisabled: true }),
      screen(driverBase, { id: "chargers", label: "Chargers", eyebrow: "3 available", title: "Where you can charge", summary: "Nearby chargers with price and availability before commitment.", state: "2 available", stateTone: "good", metrics: [m("Available", "2", "Your access", "good"), m("Charging", "1", "Main office", "info"), m("Nearest", "180 m", "Garage A"), m("Price", "27 kr/kWh", "Plus plug-time")], tableTitle: "Your chargers", queueTitle: "Before charging", action: "View nearest" }),
      screen(driverBase, { id: "active", label: "Active session", eyebrow: "Main office 02", title: "Charging in progress", summary: "Energy, observed power, time and provisional cost stay together.", state: "Charging", stateTone: "good", metrics: [m("Energy", "18.4 kWh", "Delivered", "good"), m("Observed power", "7.1 kW", "Vehicle drawing", "info"), m("Time", "01:42:18", "Transaction"), m("Current cost", "497 kr", "Provisional", "warn")], tableTitle: "Session timeline", queueTitle: "Tariff", action: "Stop charging" }),
      screen(driverBase, { id: "history", label: "History", eyebrow: "Your activity", title: "Charging history", summary: "A personal record with clear settlement state.", state: "24 sessions", stateTone: "info", metrics: [m("This month", "184 kWh", "12 sessions"), m("Settled", "10", "2 processing", "good"), m("Total cost", "5,842 kr", "Your amount"), m("Average", "15.3 kWh", "Per session")], tableTitle: "Recent charging", queueTitle: "Receipts", action: "Open latest" }),
      screen(driverBase, { id: "account", label: "Account and privacy", eyebrow: "Your identity", title: "Account and privacy", summary: "Personal data relationships and governed destructive actions.", state: "Profile complete", stateTone: "good", metrics: [m("Email", "Verified", ".test", "good"), m("Language", "English", "Icelandic later"), m("Organisations", "1", "Demo North"), m("Retention", "Policy", "View summary", "info")], tableTitle: "Account data", queueTitle: "Privacy controls", action: "Delete account", actionDisabled: true }),
      screen(driverBase, { id: "installation", label: "Installation code", eyebrow: "Future access", title: "Use an installation code", summary: "Complete visual state; submission waits for backend contracts.", state: "Unavailable", stateTone: "warn", metrics: [m("Code", "Required", "Organisation supplied"), m("Passphrase", "Required", "Separate"), m("Approval", "Per policy", "Org decision"), m("Backend", "Missing", "No success", "bad")], tableTitle: "Expected lifecycle", queueTitle: "Required contracts", notice: "Fields are a visual concept and cannot submit.", action: "Continue", actionDisabled: true }),
      screen(driverBase, { id: "help", label: "Help and support", eyebrow: "Get unstuck", title: "Help with charging", summary: "Begin with current context, then offer the right support owner.", state: "Available", stateTone: "good", metrics: [m("Current session", "None", "No active charge"), m("Nearest", "Main office", "180 m"), m("Open requests", "0", "No case"), m("Response", "15 min", "Beta target", "info")], tableTitle: "Common help", queueTitle: "Contact", action: "Report an issue" }),
    ],
  },
  {
    id: "service", label: "Service UI", shortLabel: "Service", role: "Future contractor workspace", account: "demo-tech@service.test", future: true, accent: "amber",
    navigationAbsent: "No billing, driver identity, platform administration or unassigned fleet browsing.",
    screens: [
      screen(serviceBase, { id: "queue", label: "Work queue", eyebrow: "Future service UI", title: "Assigned service work", summary: "Only accepted work, ordered by safety and service commitment.", state: "Concept", stateTone: "warn", metrics: [m("Assigned", "7", "2 urgent", "warn"), m("Today", "4", "Route 38 km"), m("Waiting parts", "2", "Customer informed"), m("SLA risk", "1", "Due in 42 min", "bad")], tableTitle: "My queue", queueTitle: "Before accepting", notice: "Future service UI; not part of market launch.", action: "Accept next job", actionDisabled: true }),
      screen(serviceBase, { id: "chargers", label: "Assigned chargers", eyebrow: "7 assigned assets", title: "Chargers in my scope", summary: "Technical identity and signal for assigned assets only.", state: "2 exceptions", stateTone: "warn", metrics: [m("Assigned", "7", "3 sites"), m("Online", "5", "Reporting", "good"), m("Offline", "1", "Case open", "bad"), m("Faulted", "1", "Visit set", "warn")], tableTitle: "Assigned assets", queueTitle: "Scope controls", action: "Open first case" }),
      screen(serviceBase, { id: "case", label: "Service case", eyebrow: "Case SV-2041", title: "Connector fault at Main office", summary: "Scope, symptoms, safety, communication and evidence in one case.", state: "Urgent", stateTone: "bad", metrics: [m("Age", "18 min", "Reported 14:02", "warn"), m("Asset", "ZPR074002", "Connector 1"), m("Contact", "Available", "After accept", "good"), m("Safety", "Not isolated", "Site owner", "bad")], tableTitle: "Case timeline", queueTitle: "Next steps", action: "Accept case", actionDisabled: true }),
      screen(serviceBase, { id: "diagnostics", label: "Diagnostics", eyebrow: "Assigned asset", title: "Technical diagnostics", summary: "Translate signals into field decisions while retaining raw codes.", state: "Read-only concept", stateTone: "info", metrics: [m("Connection", "Online", "Heartbeat 12 s", "good"), m("Connector", "Faulted", "Error 17", "bad"), m("Firmware", "2.4.1", "One behind", "warn"), m("RSSI", "3 bars", "Calibrated", "info")], tableTitle: "Diagnostic signals", queueTitle: "Guidance", action: "Run read-only check", actionDisabled: true }),
      screen(serviceBase, { id: "visit", label: "Site visit", eyebrow: "15:00–15:30", title: "Guided site visit", summary: "A field checklist for gloves, interruption and evidence continuity.", state: "Not started", stateTone: "neutral", metrics: [m("Steps", "0/6", "Sequential"), m("Travel", "12 min", "7.4 km"), m("Contact", "Demo Site Lead", ".test"), m("Isolation", "Unconfirmed", "Hard stop", "bad")], tableTitle: "Visit checklist", queueTitle: "Stop conditions", action: "Start visit", actionDisabled: true }),
      screen(serviceBase, { id: "evidence", label: "Evidence capture", eyebrow: "Case SV-2041", title: "Capture service evidence", summary: "Case-bound evidence with provenance and review before submission.", state: "0 of 5", stateTone: "warn", metrics: [m("Photos", "0/4", "Required", "warn"), m("Readings", "0/2", "Units needed"), m("Notes", "Draft", "Not submitted"), m("Location", "Withheld", "Permission")], tableTitle: "Evidence set", queueTitle: "Evidence rules", action: "Add photo", actionDisabled: true }),
      screen(serviceBase, { id: "settlement", label: "Service settlement", eyebrow: "Future commercial", title: "Work and payment summary", summary: "Separate labour, materials and travel from driver settlement.", state: "Placeholder", stateTone: "warn", metrics: [m("Labour", "1.5 h", "Draft"), m("Travel", "14.8 km", "Round trip"), m("Materials", "0 kr", "None"), m("Payment", "Unavailable", "Contract missing", "warn")], tableTitle: "Draft service lines", queueTitle: "Before enabling", notice: "No payment or invoice action exists.", action: "Submit work", actionDisabled: true }),
      screen(serviceBase, { id: "handoff", label: "Case handoff", eyebrow: "Evidence-preserving", title: "Escalate or hand back", summary: "Transfer responsibility without dropping observations or safety state.", state: "Concept", stateTone: "info", metrics: [m("Owner", "Demo Service", "Assigned"), m("Evidence", "3 items", "2 required", "warn"), m("Safety", "Not isolated", "Visible", "bad"), m("Next owner", "Unassigned", "Selection")], tableTitle: "Handoff packet", queueTitle: "Transfer rules", action: "Request handoff", actionDisabled: true }),
    ],
  },
];

export const visualScreenCount = visualFamilies.reduce((sum, family) => sum + family.screens.length, 0);
