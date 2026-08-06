import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

// Minute-precision UTC — evaluated at `next build` time, inlined into the
// bundle via the `env` option below. In `next dev` this becomes the server
// start time, which is useful for spotting "did the server pick up my change?"
const BUILD_TIME = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Legacy /tenants/* URLs redirect to /accounts/* — operators may
  // have bookmarks from before the section rename. Permanent so
  // browsers cache. Wildcard catches every sub-path.
  async redirects() {
    return [
      {
        source: "/tenants",
        destination: "/accounts",
        permanent: true,
      },
      {
        source: "/tenants/:path*",
        destination: "/accounts/:path*",
        permanent: true,
      },
    ];
  },
  experimental: {
    workerThreads: false,
    cpus: 2,
  },
  turbopack: {},
  webpack: (config) => {
    config.experiments = {
      ...(config.experiments ?? {}),
      topLevelAwait: true,
    };
    return config;
  },
  env: {
    APP_VERSION: pkg.version,
    BUILD_TIME,
  },
};

export default nextConfig;
