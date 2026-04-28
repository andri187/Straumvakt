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
  experimental: {
    workerThreads: false,
    cpus: 2,
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...(config.experiments ?? {}),
      topLevelAwait: true,
    };
    if (isServer) {
      const existing = config.externals;
      const cfExternal = ({ request }, callback) => {
        if (request === "straumvakt-prisma-cf-client" || request?.startsWith("straumvakt-prisma-cf-client/")) {
          return callback(null, "module " + request);
        }
        callback();
      };
      config.externals = Array.isArray(existing) ? [...existing, cfExternal] : [existing, cfExternal];
    }
    return config;
  },
  env: {
    APP_VERSION: pkg.version,
    BUILD_TIME,
  },
};

export default nextConfig;
