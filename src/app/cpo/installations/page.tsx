import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { draftSummary, draftView, toView } from "@/lib/installations/api";
import type { IncomingCharger } from "@/lib/installations/discovery";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { attachQuery as toAttachQuery, parseAttachParams, resolveAttach } from "@/lib/installations/attachment-selection";
import { shellDeps } from "@/lib/installations/live-bindings";
import { currentActor } from "@/lib/installations/session";
import { ContextBar } from "../workspace-ui";
import { OverviewRefresh } from "../overview-refresh";
import { enabledVendors } from "@/lib/installations/vendor-onboarding";
import { InstallationEditor, RequiredNote } from "./installation-editor";
import { InstallationsOverview } from "./installations-overview";
import { ModelPicker } from "./model-picker";
import { VendorOnboarding } from "./vendor-onboarding";

export const metadata = { title: "Installations" };
export const dynamic = "force-dynamic";

type Search = Promise<{ id?: string | string[]; new?: string | string[]; draft?: string | string[]; attach?: string | string[]; onboard?: string | string[]; add?: string | string[]; model?: string | string[] }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function State({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ws-table-wrap">
      <div className="ws-empty">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const actor = await currentActor();
  if (!actor) redirect(SHELL_SIGN_IN as Route);
  const sp = await searchParams;
  const id = first(sp.id);
  const draftParam = first(sp.draft);
  const wantsNew = first(sp.new) !== undefined || draftParam !== undefined;
  const wantsOnboard = !id && !wantsNew && first(sp.onboard) !== undefined;
  // Add installation starts at the model board (?add=1); ?new=1 is the manual editor and ?onboard=1[&model=] the OEM flow.
  const wantsAdd = !id && !wantsNew && !wantsOnboard && first(sp.add) !== undefined;
  const deps = shellDeps();
  // The charger being attached, if the operator came from the Chargers page. Only an id the server still lists as incoming
  // for the workspace CPO is honoured; the rest of the request cannot name a CPO.
  const ctxOrg = deps.contextOrgId ?? null;
  // Several may be selected (repeated `attach`), bounded and de-duplicated. They are hints only.
  const attachParams = parseAttachParams(Array.isArray(sp.attach) ? sp.attach : [sp.attach]);
  const loadCandidates = async (): Promise<IncomingCharger[]> =>
    ctxOrg ? (await deps.withRepo((r) => r.listIncoming(ctxOrg, actor)).catch(() => [] as IncomingCharger[])).filter((c) => c.state === "incoming") : [];
  const attachNote = (list: IncomingCharger[]) => {
    const { stale } = resolveAttach(attachParams, list);
    return stale.length > 0 ? (
      <p className="ws-note" role="note">{stale.join(", ")} {stale.length === 1 ? "is" : "are"} not listed as incoming any more and {stale.length === 1 ? "was" : "were"} not added. {stale.length === 1 ? "It" : "They"} may already be registered, or have not knocked recently. You can still enter an identity by hand.</p>
    ) : null;
  };
  const attachFor = (list: IncomingCharger[]) => resolveAttach(attachParams, list).matched;

  let body: React.ReactNode;
  let title = "Installations";
  let subtitle = "Locations, electrical structure and chargers.";
  let contextOrg = "all CPOs";
  let editorShown = false;
  try {
    if (id) {
      const loaded = /^[0-9a-f-]{36}$/i.test(id) ? await deps.withRepo(async (r) => [await r.get(id), await r.directory()] as const) : null;
      const found = loaded?.[0] ?? null;
      if (!found) {
        body = (
          <State title="Installation not found">
            It may have been removed, or the link is wrong. <Link href={"/cpo/installations" as Route}>Back to all installations</Link>
          </State>
        );
      } else {
        title = found.snapshot.installation.displayName;
        subtitle = "Edit this installation, its electrical structure and its chargers on one page.";
        contextOrg = `CPO: ${loaded![1].organisations.find((o) => o.id === found.snapshot.installation.orgId)?.displayName ?? "unknown"}`;
        editorShown = true;
        const cands = found.snapshot.installation.orgId === ctxOrg ? await loadCandidates() : [];
        body = <>{attachNote(cands)}<InstallationEditor key={`edit:${id}`} initial={toView(found.snapshot, found.routingId, found.history)} directory={loaded![1]} incoming={cands} attachIds={attachFor(cands)} /></>;
      }
    } else if (wantsNew) {
      title = "Add installation";
      subtitle = "";
      const contextOrgId = deps.contextOrgId ?? null;
      const resumed = !contextOrgId ? null : draftParam && /^[0-9a-f-]{36}$/i.test(draftParam) ? await deps.withRepo((r) => r.getDraft(draftParam, actor)) : null;
      if (!contextOrgId) {
        // The shared login belongs to no CPO. The association is made outside this form, never by choosing or creating one here.
        contextOrg = "no CPO associated";
        body = (
          <State title="No CPO is set for this workspace">
            The shared login does not belong to a CPO, so an operator has to associate it with one (server setting CPO_SHELL_ORG_ID) before installations can be added. Existing installations stay viewable.{" "}
            <Link href={"/cpo/installations" as Route}>All installations</Link>
          </State>
        );
      } else if (draftParam && resumed?.state !== "open") {
        // Used, discarded or unknown: say so, and never present it as an editable draft.
        body = (
          <State title={resumed?.state === "consumed" ? "That draft was already used" : "Draft not found"}>
            {resumed?.state === "consumed" && resumed.installationId ? (
              <>It was used to create an installation. <Link href={`/cpo/installations?id=${resumed.installationId}` as Route}>Open it</Link></>
            ) : (
              <>It was discarded or never existed. <Link href={"/cpo/installations?new=1" as Route}>Start a new installation</Link></>
            )}
          </State>
        );
      } else {
        const [directory, open] = await deps.withRepo(async (r) => [await r.contextDirectory(contextOrgId), resumed ? [] : await r.listDrafts(actor)] as const);
        // Keyed by what it was opened from: moving between a blank form, a resumed draft and an installation must remount,
        // or the previous form's typed text would survive under the new page.
        if (!directory) {
          contextOrg = "CPO not found";
          body = <State title="The CPO set for this workspace was not found">It does not exist or is not an active CPO organisation. Correct the association (CPO_SHELL_ORG_ID) outside this form.</State>;
        } else {
          contextOrg = `CPO: ${directory.organisations[0].displayName}`;
          editorShown = true;
          const cands = await loadCandidates();
          body = <>{attachNote(cands)}<InstallationEditor key={`new:${resumed ? resumed.id : "blank"}`} initial={null} directory={directory} initialDraft={resumed ? draftView(resumed) : null} openDrafts={open.map(draftSummary)} incoming={cands} attachIds={attachFor(cands)} /></>;
        }
      }
    } else if (wantsOnboard) {
      // The CPO is the workspace's. The page reads no OEM: connecting and onboarding are explicit actions on the installations
      // endpoint. Only the CPO's sites (database) and the list of switched-on OEMs (a setting) are read here.
      title = "Onboard from OEM";
      subtitle = "Add installations read directly from an OEM account.";
      if (!ctxOrg) {
        contextOrg = "no CPO associated";
        body = <State title="No CPO is set for this workspace">An operator has to associate the shared login with a CPO (server setting CPO_SHELL_ORG_ID) before installations can be onboarded.</State>;
      } else {
        const directory = await deps.withRepo((r) => r.contextDirectory(ctxOrg));
        if (!directory) {
          contextOrg = "CPO not found";
          body = <State title="The CPO set for this workspace was not found">It does not exist or is not an active CPO organisation. Correct the association (CPO_SHELL_ORG_ID) outside this form.</State>;
        } else {
          contextOrg = `CPO: ${directory.organisations[0].displayName}`;
          body = <VendorOnboarding directory={directory} vendors={enabledVendors(deps.env)} initialVendor={first(sp.model) ?? null} />;
        }
      }
    } else if (wantsAdd) {
      // No database read: the board needs only the deployment's list of switched-on OEMs. The manual editor (and its directory,
      // draft and incoming-charger reads) loads only if the operator chooses it.
      title = "Add installation";
      subtitle = "";
      if (!ctxOrg) {
        contextOrg = "no CPO associated";
        body = <State title="No CPO is set for this workspace">An operator has to associate the shared login with a CPO (server setting CPO_SHELL_ORG_ID) before installations can be added.</State>;
      } else {
        body = <ModelPicker enabledVendors={enabledVendors(deps.env)} manualHref={`/cpo/installations?new=1${toAttachQuery(attachParams)}`} />;
      }
    } else {
      // The list is not read here: the shell renders at once and the list loads through the shared structural store, which keeps
      // it across navigation (see installations-overview.tsx). Nothing in this branch touches the database.
      body = <InstallationsOverview attachQuery={toAttachQuery(attachParams)} />;
      if (attachParams.length > 0) body = <><p className="ws-note" role="note">Assign {attachParams.map((a, i) => <span key={a}>{i > 0 ? ", " : ""}<code>{a}</code></span>)}: choose the installation, then drag each charger to a circuit. Nothing is registered until you save. Any id the server no longer lists as incoming is reported and left out.</p>{body}</>;
    }
  } catch (error) {
    body =
      error instanceof DatabaseUnavailableError ? (
        <State title="Database not connected">
          This deployment has no database configured, so installations cannot be loaded or saved. Nothing is shown because nothing could be read.
        </State>
      ) : (
        <State title="Could not load installations">The database did not answer. Nothing was changed. Reload to try again.</State>
      );
  }

  return (
    <>
      <ContextBar organisation={contextOrg} />
      <div className="ws-title">
        <div>
          {editorShown ? <div className="ie-title-line"><h1>{title}</h1><RequiredNote /></div> : <h1>{title}</h1>}
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {!id && !wantsNew && !wantsOnboard && !wantsAdd ? (
          <div className="ie-buttons">
            <OverviewRefresh />
            <Link className="ws-button ws-primary" href={`/cpo/installations?add=1${toAttachQuery(attachParams)}` as Route} prefetch={false}>
              Add installation
            </Link>
          </div>
        ) : (
          <Link className="ws-button" href={"/cpo/installations" as Route}>
            All installations
          </Link>
        )}
      </div>
      {body}
    </>
  );
}
