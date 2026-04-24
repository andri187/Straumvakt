/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    workerThreads: false,
    cpus: 2,
  },
  turbopack: {},
};

export default nextConfig;
