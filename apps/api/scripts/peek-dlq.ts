#!/usr/bin/env tsx
/**
 * Read-only DLQ peek — pulls messages from the dead-letter queue with
 * a SHORT visibility timeout (no ack), so messages return to the DLQ
 * within a few seconds. Use this to inspect which OCPP frames the
 * projection handlers choked on.
 *
 * Usage (from apps/api/):
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     npx tsx scripts/peek-dlq.ts --dlq straumvakt-ocpp-events-dlq-staging
 *
 * Mirrors apps/api/scripts/replay-dlq.ts for queue access. The pull
 * here uses a 5s visibility window — messages re-appear in the DLQ
 * almost immediately. NO ack is sent.
 */

import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const API = "https://api.cloudflare.com/client/v4";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function cf(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN not set (export it or put in .env.local)");
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID not set");
  const url = `${API}/accounts/${accountId}${path}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  return fetch(url, { ...init, headers });
}

async function getQueueIdByName(name: string): Promise<string> {
  const resp = await cf(`/queues`);
  if (!resp.ok) throw new Error(`list queues: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as {
    result: Array<{ queue_id: string; queue_name: string }>;
  };
  const match = body.result.find((q) => q.queue_name === name);
  if (!match) throw new Error(`queue not found: ${name}`);
  return match.queue_id;
}

interface DlqMessage {
  lease_id: string;
  body: unknown;
}

async function pull(queueId: string, batchSize: number): Promise<DlqMessage[]> {
  const resp = await cf(`/queues/${queueId}/messages/pull`, {
    method: "POST",
    body: JSON.stringify({ batch_size: batchSize, visibility_timeout_ms: 5_000 }),
  });
  if (!resp.ok) throw new Error(`pull: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as {
    result: { messages: DlqMessage[] };
  };
  return body.result.messages;
}

(async () => {
  const dlqName = arg("--dlq", "straumvakt-ocpp-events-dlq-staging")!;
  const limit = Number(arg("--limit", "100"));
  const dlqId = await getQueueIdByName(dlqName);
  console.log(`[peek] dlq=${dlqName} (${dlqId}) limit=${limit}\n`);

  interface TypeStats {
    count: number;
    oldest: string;
    newest: string;
    sample: unknown;
  }
  const stats = new Map<string, TypeStats>();
  let total = 0;

  while (total < limit) {
    const batchSize = Math.min(100, limit - total);
    const messages = await pull(dlqId, batchSize);
    if (messages.length === 0) {
      console.log(`[peek] DLQ empty at total=${total}`);
      break;
    }
    for (const m of messages) {
      total++;
      const env = m.body as {
        eventType?: string;
        occurredAt?: string;
        payload?: { action?: string };
      };
      const type = env?.eventType ?? "(unknown)";
      const action = env?.payload?.action ?? "—";
      const key = `${type} (${action})`;
      const occurredAt = env?.occurredAt ?? "—";
      const cur = stats.get(key);
      if (!cur) {
        stats.set(key, {
          count: 1,
          oldest: occurredAt,
          newest: occurredAt,
          sample: m.body,
        });
      } else {
        cur.count++;
        if (occurredAt < cur.oldest) cur.oldest = occurredAt;
        if (occurredAt > cur.newest) cur.newest = occurredAt;
      }
    }
    if (messages.length < batchSize) {
      console.log(`[peek] short batch, likely DLQ drained at total=${total}`);
      break;
    }
  }

  console.log(`\n=== DLQ breakdown by eventType (${total} messages pulled) ===\n`);
  console.log(
    "  count  eventType (action)                          oldest occurredAt           newest occurredAt",
  );
  const sorted = Array.from(stats.entries()).sort(
    (a, b) => b[1].count - a[1].count,
  );
  for (const [key, s] of sorted) {
    console.log(
      `  ${s.count.toString().padStart(5)}  ${key.padEnd(44)}  ${s.oldest}  ${s.newest}`,
    );
  }

  console.log(`\n=== Sample envelope per type ===\n`);
  for (const [key, s] of stats.entries()) {
    console.log(`── ${key} ─────────────────────`);
    console.log(JSON.stringify(s.sample, null, 2));
    console.log();
  }

  console.log("Messages NOT ack'd — they will return to the DLQ in 5s.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
