import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext configuration for Cloudflare Workers deployment.
 *
 * Milestone 0: first deploy with no caching backend wired up yet.
 * "dummy" for incrementalCache/tagCache/queue means ISR/PPR revalidation
 * falls back to rebuilding on every request — fine while the platform
 * is serving only the login + dashboard shell.
 *
 * When a KV namespace is available, swap the "dummy" values for the KV-
 * backed variants exported from @opennextjs/cloudflare/overrides/*.
 */
export default defineCloudflareConfig({
  incrementalCache: "dummy",
  tagCache: "dummy",
  queue: "dummy",
});
