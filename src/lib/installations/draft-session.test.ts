import { describe, expect, it } from "vitest";
import {
  afterCreate,
  afterDiscard,
  afterSaveDraft,
  createDraftRef,
  createSingleFlight,
  detach,
  saveDraftBody,
  startSession,
  type ServerAnswer,
} from "./draft-session";

const ans = (status: number, json: Record<string, unknown> = {}): ServerAnswer => ({ ok: status >= 200 && status < 300, status, json });
const sess = (revision?: number) => ({ id: "draft-1", revision });

describe("single flight: overlapping actions", () => {
  const deferred = <T = void>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it("ignores a second action while one is in flight, whatever its kind, and runs it only once", async () => {
    const seen: (string | null)[] = [];
    const flight = createSingleFlight<"save" | "draft" | "discard">((c) => seen.push(c));
    const gate = deferred();
    let runs = 0;
    const first = flight.run("save", async () => { runs++; await gate.promise; return "created"; });
    // Create clicked twice, then a draft save and a discard while it is still running.
    expect(await flight.run("save", async () => { runs++; return "dup"; })).toEqual({ ran: false });
    expect(await flight.run("draft", async () => { runs++; return "x"; })).toEqual({ ran: false });
    expect(await flight.run("discard", async () => { runs++; return "y"; })).toEqual({ ran: false });
    expect(flight.current).toBe("save");
    gate.resolve();
    expect(await first).toEqual({ ran: true, value: "created" });
    expect(runs).toBe(1);
    expect(flight.current).toBeNull();
    expect(seen).toEqual(["save", null]); // the UI is told once to lock and once to unlock
  });

  it("frees the slot when the action throws, so one failed request cannot lock the form for good", async () => {
    const flight = createSingleFlight<"save">();
    await expect(flight.run("save", async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(flight.current).toBeNull();
    expect(await flight.run("save", async () => 1)).toEqual({ ran: true, value: 1 });
  });
});

describe("the session", () => {
  it("a new form gets its own draft id and no revision until the server confirms the draft", () => {
    const s = startSession(undefined, () => "fresh-id");
    expect(s).toEqual({ id: "fresh-id", revision: undefined });
    expect(startSession({ id: "d", revision: 4 })).toEqual({ id: "d", revision: 4 });
  });

  it("the first save creates (no revision); later saves name the revision they were built on", () => {
    expect(saveDraftBody(sess(), "org-1", { a: 1 })).toEqual({ action: "save-draft", draftId: "draft-1", orgId: "org-1", payload: { a: 1 } });
    expect(saveDraftBody(sess(3), "", { a: 1 })).toEqual({ action: "save-draft", draftId: "draft-1", orgId: null, expectedRevision: 3, payload: { a: 1 } });
  });
});

describe("saving a draft", () => {
  it("records the revision the server returned, so the next save builds on it", () => {
    expect(afterSaveDraft(sess(), ans(201, { draft: { revision: 1 }, created: true }))).toEqual({ kind: "saved", session: sess(1), unchanged: false });
    expect(afterSaveDraft(sess(1), ans(200, { draft: { revision: 1 }, unchanged: true }))).toEqual({ kind: "saved", session: sess(1), unchanged: true });
  });

  it("a stale answer keeps the session as it was: newer text elsewhere is never overwritten from here", () => {
    const out = afterSaveDraft(sess(1), ans(409, { error: "stale_revision", currentRevision: 2 }));
    expect(out).toEqual({ kind: "stale", session: sess(1) });
  });

  it("a DISCARDED draft takes no more changes; the next save starts a new draft under a new id", () => {
    const out = afterSaveDraft(sess(2), ans(409, { error: "draft_unavailable", draftState: "discarded" }), () => "next-id");
    expect(out).toEqual({ kind: "gone", session: { id: "next-id", revision: undefined } });
  });

  it("a USED draft is not replaced by a new one: the installation exists, so the form must not quietly start over", () => {
    const out = afterSaveDraft(sess(2), ans(409, { error: "draft_unavailable", draftState: "consumed", installationId: "inst-1" }), () => "next-id");
    expect(out).toEqual({ kind: "consumed", session: sess(2), installationId: "inst-1" });
  });

  it("the draft limit, and any 409 that does not say why, change nothing about the session", () => {
    expect(afterSaveDraft(sess(), ans(409, { error: "draft_unavailable", draftState: "limit", message: "25 drafts" }), () => "next-id")).toEqual({ kind: "failed", session: sess() });
    expect(afterSaveDraft(sess(2), ans(409, { error: "draft_unavailable" }), () => "next-id")).toEqual({ kind: "failed", session: sess(2) });
    expect(afterSaveDraft(sess(2), ans(409, { error: "something_else" }), () => "next-id")).toEqual({ kind: "failed", session: sess(2) });
  });

  it("keeps the session on validation and transport failures, so retrying the same save is the same request", () => {
    expect(afterSaveDraft(sess(2), ans(422, { problems: [{ path: "payload.name", message: "Too long" }] }))).toEqual({ kind: "invalid", session: sess(2), problems: [{ path: "payload.name", message: "Too long" }] });
    expect(afterSaveDraft(sess(2), ans(503))).toEqual({ kind: "failed", session: sess(2) });
    expect(afterSaveDraft(sess(), ans(401))).toEqual({ kind: "failed", session: sess() });
  });
});

describe("creating the installation", () => {
  it("cites the draft only once the server has confirmed it exists", () => {
    expect(createDraftRef(sess())).toEqual({});
    expect(createDraftRef(sess(2))).toEqual({ draftId: "draft-1" });
  });

  it("a successful create leaves no draft behind to cite again", () => {
    expect(afterCreate(sess(2), ans(200, { installation: {} }))).toEqual({ kind: "created", session: sess() });
    expect(createDraftRef(afterCreate(sess(2), ans(200)).session)).toEqual({});
  });

  it("a USED draft means the installation may already exist: no new draft id, and the form is told which installation it is", () => {
    const out = afterCreate(sess(2), ans(409, { error: "draft_unavailable", draftState: "consumed", installationId: "inst-1" }), () => "next-id");
    expect(out).toEqual({ kind: "draft_consumed", session: sess(2), installationId: "inst-1" });
    const unknown = afterCreate(sess(2), ans(409, { error: "draft_unavailable", draftState: "consumed" }), () => "next-id");
    expect(unknown).toEqual({ kind: "draft_consumed", session: sess(2), installationId: null });
  });

  it("a DISCARDED draft created nothing; the form is detached from it and nothing is created until the operator presses Create again", () => {
    const out = afterCreate(sess(2), ans(409, { error: "draft_unavailable", draftState: "discarded" }), () => "next-id");
    expect(out).toEqual({ kind: "draft_gone", session: { id: "next-id", revision: undefined } });
    expect(createDraftRef(out.session)).toEqual({});
  });

  it("a 409 that does not say why is never treated as a discarded draft", () => {
    expect(afterCreate(sess(2), ans(409, { error: "draft_unavailable" }), () => "next-id")).toEqual({ kind: "other", session: sess(2) });
  });

  it("detaching deliberately gives the form a fresh draft id and nothing else", () => {
    expect(detach(() => "fresh")).toEqual({ id: "fresh", revision: undefined });
  });

  it("any other failure keeps the session, so the retry (same idempotency key) still names the same draft", () => {
    expect(afterCreate(sess(2), ans(422, { problems: [] }))).toEqual({ kind: "other", session: sess(2) });
    expect(afterCreate(sess(2), ans(503))).toEqual({ kind: "other", session: sess(2) });
  });
});

describe("discarding", () => {
  it("counts discarded, already discarded and unknown as done, and an already used draft as NOT discarded", () => {
    expect(afterDiscard(sess(2), ans(200, { outcome: "discarded" })).kind).toBe("gone");
    expect(afterDiscard(sess(2), ans(200, { outcome: "already_discarded" })).kind).toBe("gone");
    expect(afterDiscard(sess(2), ans(404, { error: "not_found" })).kind).toBe("gone");
    expect(afterDiscard(sess(2), ans(200, { outcome: "already_used", installationId: "i" })).kind).toBe("already_used");
  });

  it("a failed discard keeps the draft, so Cancel never leaves believing it was discarded", () => {
    expect(afterDiscard(sess(2), ans(503))).toEqual({ kind: "failed", session: sess(2) });
    expect(afterDiscard(sess(2), ans(401))).toEqual({ kind: "failed", session: sess(2) });
  });
});
