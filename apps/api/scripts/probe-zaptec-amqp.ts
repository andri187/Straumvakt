#!/usr/bin/env tsx
/**
 * Sprint 9 (probe phase) — Azure Service Bus listener for one Zaptec
 * installation. Confirms three preconditions before committing to the
 * AMQP build:
 *
 *   1. MessagingEnabled is true on the installation.
 *   2. Our partner credential has scope to fetch
 *      /api/installation/{id}/messagingConnectionDetails.
 *   3. What event types Zaptec actually pushes (auth taps? sessions?
 *      meter values? state changes only?).
 *
 * Listens until Ctrl+C, logging every received message verbatim to a
 * JSONL file alongside live stats. SAS token in the connection
 * details is redacted in console output but persists in the JSONL
 * for offline replay (file is .gitignored — see .gitignore line at
 * end of this header).
 *
 * Usage:
 *   $env:ZAPTEC_PASSWORD="<plaintext>"
 *   $env:ZAPTEC_USERNAME="andrith187@gmail.com"   # optional, falls back to DB lookup
 *   $env:DALVEGUR_INSTALLATION_ID="<uuid>"        # optional; if unset, picks first MessagingEnabled installation
 *   npx tsx scripts/probe-zaptec-amqp.ts
 *
 * Output:
 *   apps/api/scripts/zaptec-amqp-probe.jsonl
 *
 * Cost: AMQP connection from local laptop to Azure Service Bus West
 * Europe. Runs for as long as the operator wants. No cost to Zaptec
 * — the SAS token has scope only to read this installation's events.
 */
import { ServiceBusClient } from "@azure/service-bus";
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { appendFile, writeFile } from "node:fs/promises";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const ZAPTEC_BASE = "https://api.zaptec.com";
const OUTPUT = resolve(process.cwd(), "scripts/zaptec-amqp-probe.jsonl");

interface MessagingConnectionDetails {
  Type?: number;
  Host: string;
  Port: number;
  UseSSL?: boolean;
  Username: string;
  Password: string; // SAS — never display
  Topic: string;
  Subscription: string;
}

interface InstallationLite {
  Id: string;
  Name?: string;
  MessagingEnabled?: boolean;
}

async function main() {
  const password = process.env.ZAPTEC_PASSWORD;
  if (!password) {
    console.error(
      "ZAPTEC_PASSWORD env var not set. Aborting — won't probe without auth.",
    );
    process.exit(1);
  }

  // Username fallback: if not given, look up the active Zaptec
  // credential from the DB (we only ever have one in this pilot).
  let username = process.env.ZAPTEC_USERNAME;
  if (!username) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(
      `select username from hardware.vendor_credentials
       where status = 'active' limit 1`,
    );
    await c.end();
    username = r.rows[0]?.username;
    if (!username) {
      console.error("No active vendor credential in DB and no ZAPTEC_USERNAME env var.");
      process.exit(1);
    }
    console.log(`Using DB-lookup username: ${username}`);
  }

  // ── Step 1: OAuth ──────────────────────────────────────────────
  console.log("[1/4] OAuth password grant…");
  const tokenRes = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
    }),
  });
  if (!tokenRes.ok) {
    console.error(`OAuth failed: ${tokenRes.status} ${await tokenRes.text()}`);
    process.exit(1);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  console.log(`     ✓ Bearer token acquired.`);

  // ── Step 2: Pick installation ─────────────────────────────────
  console.log("[2/4] Listing installations…");
  const installListRes = await fetch(`${ZAPTEC_BASE}/api/installation`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!installListRes.ok) {
    console.error(`/api/installation failed: ${installListRes.status}`);
    process.exit(1);
  }
  const installList = (await installListRes.json()) as {
    Data?: InstallationLite[];
  };
  const installations = installList.Data ?? [];
  console.log(`     ✓ ${installations.length} installation(s) visible:`);
  for (const i of installations) {
    console.log(
      `         ${i.Id}  ${i.Name ?? "(unnamed)"}  ` +
        `MessagingEnabled=${i.MessagingEnabled ?? "(unknown — needs detail fetch)"}`,
    );
  }

  let installationId = process.env.DALVEGUR_INSTALLATION_ID;
  if (!installationId) {
    // Pick first MessagingEnabled, else first overall.
    const candidate =
      installations.find((i) => i.MessagingEnabled === true) ?? installations[0];
    if (!candidate) {
      console.error("No installations visible. Aborting.");
      process.exit(1);
    }
    installationId = candidate.Id;
  }
  console.log(`     ✓ Using installation ${installationId}`);

  // ── Step 3: messagingConnectionDetails ─────────────────────────
  console.log(`[3/4] Fetching messagingConnectionDetails…`);
  const mcdRes = await fetch(
    `${ZAPTEC_BASE}/api/installation/${installationId}/messagingConnectionDetails`,
    { headers: { Authorization: `Bearer ${access_token}` } },
  );
  if (!mcdRes.ok) {
    console.error(`     ✗ ${mcdRes.status}: ${await mcdRes.text()}`);
    console.error(
      "     This is the precondition that gates the entire AMQP build.",
    );
    console.error(
      "     Possible reasons:",
    );
    console.error(
      "       (a) MessagingEnabled is false on this installation (Zaptec ticket to flip)",
    );
    console.error(
      "       (b) Our credential lacks the partner-tier scope (also a Zaptec ticket)",
    );
    console.error(
      "       (c) Endpoint deprecated / renamed (unlikely; docs are recent)",
    );
    process.exit(1);
  }
  const mcd = (await mcdRes.json()) as MessagingConnectionDetails;
  console.log(`     ✓ Connection details received:`);
  console.log(`         Host:         ${mcd.Host}:${mcd.Port}`);
  console.log(`         Username:     ${mcd.Username}`);
  console.log(`         Topic:        ${mcd.Topic}`);
  console.log(`         Subscription: ${mcd.Subscription}`);
  console.log(`         SAS:          [redacted, ${mcd.Password.length} chars]`);

  // ── Step 4: Open subscription + listen ────────────────────────
  console.log(`[4/4] Opening AMQP subscription…`);

  // Connection-string format Service Bus SDK expects:
  // Endpoint=sb://<host>/;SharedAccessKeyName=<username>;SharedAccessKey=<sas>
  // The SAS Zaptec returns is already a full SAS token (sr=...&sig=...&se=...&skn=...);
  // we use the alternative AzureSASCredential form below instead.
  const fqdn = mcd.Host;
  // Service Bus accepts the full SAS as a connection string when wrapped
  // with SharedAccessSignature= prefix.
  const connectionString = `Endpoint=sb://${fqdn}/;SharedAccessSignature=${mcd.Password}`;
  const sbClient = new ServiceBusClient(connectionString);

  const receiver = sbClient.createReceiver(mcd.Topic, mcd.Subscription, {
    receiveMode: "peekLock",
  });

  // Reset output file
  await writeFile(OUTPUT, "");
  console.log(`     ✓ Opened. Logging every message to ${OUTPUT}`);
  console.log(`\nListening… Ctrl+C to stop.\n`);

  let totalMessages = 0;
  const subjectCounts = new Map<string, number>();
  const startedAt = Date.now();

  const subscription = receiver.subscribe(
    {
      processMessage: async (msg) => {
        totalMessages++;
        const subject = msg.subject ?? "(no-subject)";
        subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);

        const record = {
          receivedAt: new Date().toISOString(),
          messageId: msg.messageId,
          subject: msg.subject,
          contentType: msg.contentType,
          enqueuedTimeUtc: msg.enqueuedTimeUtc,
          applicationProperties: msg.applicationProperties,
          body: msg.body,
        };
        await appendFile(OUTPUT, JSON.stringify(record) + "\n");

        // Live console echo, truncated for readability
        console.log(
          `[${new Date().toISOString().slice(11, 19)}] ${subject.padEnd(30)} ${
            typeof msg.body === "string"
              ? msg.body.slice(0, 80)
              : JSON.stringify(msg.body).slice(0, 80)
          }`,
        );

        await receiver.completeMessage(msg);
      },
      processError: async (err) => {
        console.error(
          `[ERROR ${err.errorSource}] ${err.error.message}`,
        );
      },
    },
    { autoCompleteMessages: false },
  );

  // Periodic stats
  const stats = setInterval(() => {
    const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
    console.log(
      `\n--- ${minutes}m elapsed, ${totalMessages} messages, subjects:`,
    );
    for (const [s, n] of subjectCounts.entries()) {
      console.log(`      ${s}: ${n}`);
    }
    console.log("");
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(stats);
    console.log("\nShutting down…");
    await subscription.close();
    await receiver.close();
    await sbClient.close();
    console.log(
      `\nFinal: ${totalMessages} messages logged to ${OUTPUT} over ${(
        (Date.now() - startedAt) /
        60_000
      ).toFixed(1)} minutes.`,
    );
    console.log("Subjects observed:");
    for (const [s, n] of subjectCounts.entries()) {
      console.log(`  ${s}: ${n}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
