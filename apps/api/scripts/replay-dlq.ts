#!/usr/bin/env tsx

// `export {}` makes this a module rather than a global script. Without it
// TypeScript puts every top-level declaration in one shared scope, so this
// file's `Args` and `parseArgs` collided with replay-dlq.ts's — 44 errors
// between two files that never import each other. Invisible until
// scripts/ was added to a tsconfig, which nothing had done.
export {};

/**
 * DLQ replay script — Sprint 5 / ADR 0017.
 *
 * When the inbound OCPP events queue routes a message to its DLQ
 * (`straumvakt-ocpp-events-dlq-staging`), the operator needs to:
 *
 *   1. Diagnose: read the messages out of the DLQ, inspect the failure
 *      mode (poison shape? Postgres outage? Hyperdrive blip?).
 *   2. Resolve: fix the underlying issue (deploy the schema fix, wait
 *      out the outage).
 *   3. Replay: shovel the DLQ messages back onto the main queue.
 *
 * This script handles step 3. It pulls messages from the DLQ in
 * batches, re-publishes each onto the main queue, and ack's the DLQ
 * copy on success.
 *
 * Usage (from apps/api/):
 *   wrangler dev --remote   # in another terminal — gives the consumer
 *                           # a live consumer for the main queue
 *   npx tsx scripts/replay-dlq.ts \
 *     --dlq straumvakt-ocpp-events-dlq-staging \
 *     --main straumvakt-ocpp-events-staging \
 *     --limit 100
 *
 * The script does NOT call wrangler bindings directly — Cloudflare
 * Queues' HTTP API is the operator-facing surface. Run with the
 * CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars set.
 *
 * Sprint 10 will replace this with an in-console UI surface.
 */

const API = "https://api.cloudflare.com/client/v4";

type Args = {
  dlq: string;
  main: string;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { limit: 100 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dlq") args.dlq = argv[++i];
    else if (arg === "--main") args.main = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
  }
  if (!args.dlq || !args.main) {
    throw new Error("usage: replay-dlq.ts --dlq <name> --main <name> [--limit N]");
  }
  return args as Args;
}

async function cf(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN not set");
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID not set");
  const url = `${API}/accounts/${accountId}${path}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  return fetch(url, { ...init, headers });
}

async function getQueueIdByName(name: string): Promise<string> {
  const resp = await cf(`/queues`);
  if (!resp.ok) throw new Error(`list queues: ${resp.status}`);
  const body = (await resp.json()) as {
    result: Array<{ queue_id: string; queue_name: string }>;
  };
  const match = body.result.find((q) => q.queue_name === name);
  if (!match) throw new Error(`queue not found: ${name}`);
  return match.queue_id;
}

async function pullBatch(
  queueId: string,
  batchSize: number,
): Promise<Array<{ lease_id: string; body: unknown }>> {
  const resp = await cf(`/queues/${queueId}/messages/pull`, {
    method: "POST",
    body: JSON.stringify({ batch_size: batchSize, visibility_timeout_ms: 30_000 }),
  });
  if (!resp.ok) throw new Error(`pull: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as {
    result: { messages: Array<{ lease_id: string; body: unknown }> };
  };
  return body.result.messages;
}

async function pushMessage(queueId: string, body: unknown): Promise<void> {
  const resp = await cf(`/queues/${queueId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, content_type: "json" }),
  });
  if (!resp.ok) throw new Error(`push: ${resp.status} ${await resp.text()}`);
}

async function ackBatch(
  queueId: string,
  leases: string[],
): Promise<void> {
  if (leases.length === 0) return;
  const resp = await cf(`/queues/${queueId}/messages/ack`, {
    method: "POST",
    body: JSON.stringify({ acks: leases.map((id) => ({ lease_id: id })) }),
  });
  if (!resp.ok) throw new Error(`ack: ${resp.status} ${await resp.text()}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dlqId = await getQueueIdByName(args.dlq);
  const mainId = await getQueueIdByName(args.main);
  console.log(`[replay] dlq=${args.dlq} (${dlqId}) main=${args.main} (${mainId})`);

  let total = 0;
  while (total < args.limit) {
    const batchSize = Math.min(100, args.limit - total);
    const messages = await pullBatch(dlqId, batchSize);
    if (messages.length === 0) {
      console.log(`[replay] dlq drained at total=${total}`);
      break;
    }
    const replayed: string[] = [];
    for (const m of messages) {
      try {
        await pushMessage(mainId, m.body);
        replayed.push(m.lease_id);
      } catch (err) {
        console.error(`[replay] push failed for lease ${m.lease_id}`, err);
      }
    }
    await ackBatch(dlqId, replayed);
    total += replayed.length;
    console.log(`[replay] batch=${messages.length} replayed=${replayed.length} total=${total}`);
  }
  console.log(`[replay] done total=${total}`);
}

main().catch((err) => {
  console.error("[replay] fatal", err);
  process.exit(1);
});
