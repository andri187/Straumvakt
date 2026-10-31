// Content and navigation for the CPO test workspace. Every screen is honestly
// unconnected: no records, invitations, commissioning, access changes or cost
// terms exist behind it, so no figure, list or status is shown and each
// unavailable action says why. When a screen gains a real data source, replace
// its `empty` content with the live view; the navigation does not change.

export type NavIconKey =
  | "overview"
  | "people"
  | "installations"
  | "chargers"
  | "sessions"
  | "costs"
  | "agreements"
  | "settings";

export type NavItem = {
  key: NavIconKey;
  label: string;
  href: string;
  summary: string;
};

export const NAV_GROUPS: readonly { heading: string; items: readonly NavItem[] }[] = [
  {
    heading: "Workspace",
    items: [
      {
        key: "overview",
        label: "Overview",
        href: "/cpo",
        summary: "Key indicators for the shared test login.",
      },
      {
        key: "people",
        label: "People & access",
        href: "/cpo/people",
        summary: "People, invitations and driver groups.",
      },
    ],
  },
  {
    heading: "Charging",
    items: [
      {
        key: "installations",
        label: "Installations",
        href: "/cpo/installations",
        summary: "Locations and their electrical structure.",
      },
      {
        key: "chargers",
        label: "Chargers",
        href: "/cpo/chargers",
        summary: "Equipment, incoming connections and setup progress.",
      },
      {
        key: "sessions",
        label: "Sessions",
        href: "/cpo/sessions",
        summary: "Charging activity and refused starts.",
      },
    ],
  },
  {
    heading: "Costs",
    items: [
      {
        key: "costs",
        label: "Cost factors & rates",
        href: "/cpo/costs",
        summary: "The parts of a session's cost and their rates.",
      },
      {
        key: "agreements",
        label: "Agreements & sponsorship",
        href: "/cpo/agreements",
        summary: "Who accepts which costs, and for whom.",
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  key: "settings",
  label: "Organisation settings",
  href: "/cpo/settings",
  summary: "Organisation details, representation and activity.",
};

export type Action = { label: string; reason: string };

export type TabContent =
  | {
      kind: "table";
      columns: readonly string[];
      emptyTitle: string;
      emptyDetail: string;
    }
  | {
      kind: "facts";
      facts: readonly (readonly [string, string])[];
    };

export type ShellTab = {
  key: string;
  label: string;
  note?: string;
  action?: Action;
  content: TabContent;
};

export type ShellPage = {
  key: Exclude<NavIconKey, "overview">;
  href: string;
  title: string;
  subtitle: string;
  tabs: readonly ShellTab[];
};

const NOT_CONNECTED = "Not connected";

export const SHELL_PAGES: readonly ShellPage[] = [
  {
    key: "people",
    href: "/cpo/people",
    title: "People & access",
    subtitle: "People, invitations and charging access in an organisation.",
    tabs: [
      {
        key: "people",
        label: "People",
        action: {
          label: "Invite person",
          reason:
            "Inviting people is not available yet. An invitation will propose an organisation relationship without granting charging access.",
        },
        content: {
          kind: "table",
          columns: ["Person", "Responsibility", "Scope", "State"],
          emptyTitle: "No people to show",
          emptyDetail:
            "People are not connected to this workspace yet, so no list can be shown. This does not confirm that an organisation has no people.",
        },
      },
      {
        key: "invitations",
        label: "Invitations",
        note: "Invitations propose an organisation relationship. They do not grant charging access or accept financial terms by themselves.",
        action: {
          label: "Invite person",
          reason:
            "Inviting people is not available yet. Nothing can be sent from this workspace.",
        },
        content: {
          kind: "table",
          columns: ["Person", "Email", "Proposed role", "State"],
          emptyTitle: "No invitations to show",
          emptyDetail:
            "Invitations are not connected yet, so none can be listed or sent.",
        },
      },
      {
        key: "groups",
        label: "Driver groups",
        action: {
          label: "Create driver group",
          reason:
            "Creating driver groups is not available yet. Groups need people to exist first.",
        },
        content: {
          kind: "table",
          columns: ["Driver group", "Members", "Purpose", "State"],
          emptyTitle: "No driver groups to show",
          emptyDetail: "Driver groups are not connected yet, so none can be listed.",
        },
      },
    ],
  },
  {
    key: "installations",
    href: "/cpo/installations",
    title: "Installations",
    subtitle: "Locations, electrical structure and readiness.",
    tabs: [
      {
        key: "all",
        label: "All installations",
        note: "Circuits belong inside an installation. They will be managed from an installation's own details once one exists.",
        action: {
          label: "Add installation",
          reason:
            "Adding an installation is not available yet. Installation records are not connected to this workspace.",
        },
        content: {
          kind: "table",
          columns: ["Installation", "Site", "Circuits", "Chargers", "State"],
          emptyTitle: "No installations to show",
          emptyDetail:
            "Installations are not connected yet, so none can be listed. This does not confirm that none exist.",
        },
      },
    ],
  },
  {
    key: "chargers",
    href: "/cpo/chargers",
    title: "Chargers",
    subtitle: "Equipment, incoming connections and setup progress.",
    tabs: [
      {
        key: "all",
        label: "All chargers",
        note: "Setup, placement and activation will be handled from a charger's own details once a charger is registered.",
        action: {
          label: "Register charger",
          reason:
            "Registering a charger is not available yet. Charger control is switched off in this workspace.",
        },
        content: {
          kind: "table",
          columns: ["Charger", "Device identity", "Installation", "State"],
          emptyTitle: "No chargers to show",
          emptyDetail:
            "No charger is connected to this workspace, so no status is shown. This does not mean a charger is offline.",
        },
      },
      {
        key: "incoming",
        label: "Incoming",
        note: "Only connections already associated with an organisation would be shown here. Unassigned connections stay in the platform's restricted view.",
        action: {
          label: "Register charger",
          reason:
            "Registering a charger is not available yet. Charger control is switched off in this workspace.",
        },
        content: {
          kind: "table",
          columns: ["Charger", "Device identity", "Installation", "State"],
          emptyTitle: "No incoming connections to show",
          emptyDetail:
            "Incoming connections are not connected yet, so none can be listed.",
        },
      },
      {
        key: "groups",
        label: "Charger groups",
        action: {
          label: "Create charger group",
          reason:
            "Creating charger groups is not available yet. Groups need chargers to exist first.",
        },
        content: {
          kind: "table",
          columns: ["Group", "Chargers", "Purpose", "State"],
          emptyTitle: "No charger groups to show",
          emptyDetail: "Charger groups are not connected yet, so none can be listed.",
        },
      },
    ],
  },
  {
    key: "sessions",
    href: "/cpo/sessions",
    title: "Sessions",
    subtitle: "Charging activity, refused starts and their costs.",
    tabs: [
      {
        key: "all",
        label: "All sessions",
        note: "Costs and responsible payers belong inside a session's own details. No session can be opened yet.",
        content: {
          kind: "table",
          columns: ["Session", "Driver", "Energy", "State"],
          emptyTitle: "No sessions to show",
          emptyDetail:
            "Session records are not connected yet, so a count of none cannot be confirmed. Nothing here is a measured total.",
        },
      },
      {
        key: "attention",
        label: "Needs attention",
        note: "Refused starts and sessions that cannot be costed will be listed here.",
        content: {
          kind: "table",
          columns: ["Session", "Reason", "Charger", "State"],
          emptyTitle: "No items to show",
          emptyDetail:
            "Session records are not connected yet, so attention items cannot be assessed.",
        },
      },
    ],
  },
  {
    key: "costs",
    href: "/cpo/costs",
    title: "Cost factors & rates",
    subtitle: "The parts of a session's cost and their effective rates.",
    tabs: [
      {
        key: "factors",
        label: "Cost factors",
        action: {
          label: "Add cost factor",
          reason:
            "Adding cost factors is not available yet. Rates need an organisation and installations to apply to.",
        },
        content: {
          kind: "table",
          columns: ["Factor", "Unit", "Rate", "Applies to", "State"],
          emptyTitle: "No cost factors to show",
          emptyDetail:
            "Prices are not connected yet, so no rate is shown. No invoice is created or sent from here.",
        },
      },
      {
        key: "history",
        label: "Rate history",
        note: "Rates will be listed with their effective dates.",
        content: {
          kind: "table",
          columns: ["Factor", "Rate", "Effective period", "State"],
          emptyTitle: "No rate history to show",
          emptyDetail: "Rate history is not connected yet, so nothing can be listed.",
        },
      },
    ],
  },
  {
    key: "agreements",
    href: "/cpo/agreements",
    title: "Agreements & sponsorship",
    subtitle: "Who accepts which costs, for whom, and for how long.",
    tabs: [
      {
        key: "agreements",
        label: "Agreements",
        action: {
          label: "Draft sponsorship",
          reason:
            "Drafting sponsorship is not available yet. Agreements need people and cost factors first.",
        },
        content: {
          kind: "table",
          columns: ["Agreement", "Payer", "Coverage", "State"],
          emptyTitle: "No agreements to show",
          emptyDetail: "Agreements are not connected yet, so none can be listed.",
        },
      },
      {
        key: "sponsorship",
        label: "Sponsorship",
        note: "Sponsorship covers whole cost factors for the people it applies to.",
        action: {
          label: "Draft sponsorship",
          reason:
            "Drafting sponsorship is not available yet. Agreements need people and cost factors first.",
        },
        content: {
          kind: "table",
          columns: ["Sponsorship", "Sponsor", "Covered factor", "Driver group", "State"],
          emptyTitle: "No sponsorship to show",
          emptyDetail: "Sponsorship is not connected yet, so none can be listed.",
        },
      },
    ],
  },
  {
    key: "settings",
    href: "/cpo/settings",
    title: "Organisation settings",
    subtitle: "Organisation details and accountable representation.",
    tabs: [
      {
        key: "details",
        label: "Organisation details",
        note: "This shared test login has no organisation, platform, installer or installation-representative role, and it cannot change settings.",
        action: {
          label: "Edit organisation",
          reason:
            "Editing is not available yet. No organisation is connected to this workspace.",
        },
        content: {
          kind: "facts",
          facts: [
            ["Sign-in", "Shared test login"],
            ["Organisation", NOT_CONNECTED],
            ["Registered name", NOT_CONNECTED],
            ["Representative", NOT_CONNECTED],
          ],
        },
      },
      {
        key: "representation",
        label: "Representation",
        content: {
          kind: "table",
          columns: ["Person", "Authority", "Scope", "State"],
          emptyTitle: "No representation to show",
          emptyDetail:
            "Representation is not connected yet, so nobody is shown as authorised.",
        },
      },
      {
        key: "activity",
        label: "Activity",
        content: {
          kind: "table",
          columns: ["When", "Who", "What", "State"],
          emptyTitle: "No activity to show",
          emptyDetail:
            "Activity history is not connected yet, so nothing can be listed.",
        },
      },
    ],
  },
];

/** Every protected workspace page, for route policy and edge checks. */
export const WORKSPACE_PATHS: readonly string[] = [
  "/cpo",
  ...SHELL_PAGES.map((page) => page.href),
];

export function getShellPage(key: ShellPage["key"]): ShellPage {
  const page = SHELL_PAGES.find((p) => p.key === key);
  if (!page) throw new Error(`Unknown shell page: ${key}`);
  return page;
}

/** An unknown or repeated `tab` value falls back to the first tab. */
export function resolveTab(page: ShellPage, raw: string | string[] | undefined): ShellTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return page.tabs.find((tab) => tab.key === value) ?? page.tabs[0];
}
