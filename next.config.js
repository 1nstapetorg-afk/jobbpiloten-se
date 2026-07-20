const nextConfig = {
  // NOTE on output mode: this project ships to Vercel's managed
  // platform (serverless + edge). The standalone output mode is
  // intended for self-hosted Docker / containerized deployments
  // — when it is set globally on a Vercel project the bundler
  // emits its build artifacts under .next/standalone/ AND the
  // Vercel CDN's static-asset path resolution can drift, leading
  // to a preview deploy that renders unstyled HTML (the CSS
  // bundle path doesn't match what the served HTML expects).
  // Vercel handles its own per-route serverless packaging
  // without an explicit output, so we deliberately leave this
  // unset. The regression lock lives in
  // tests/unit/next-config-no-standalone.test.mjs.
  //
  // Vercel's bundler tree-shakes Serverless Functions aggressively.
  // Our /api/extension/download route reads files from ./extension/
  // at runtime via fs (NOT via static import), so the bundler can't
  // trace the dependency and would otherwise ship a function that
  // crashes with ENOENT the first time someone hits the endpoint.
  // The include hint below forces the trace to keep every file under
  // ./extension/ alongside the route's compiled output.
  // See https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
  outputFileTracingIncludes: {
    '/api/extension/download': ['./extension/**/*'],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com', pathname: '/**' },
    ],
  },
  // Renamed from experimental.serverComponentsExternalPackages in Next 15
  serverExternalPackages: ['mongodb'],
  webpack(config, { dev }) {
    if (dev) {
      // Reduce CPU/memory from file watching
      config.watchOptions = {
        poll: 2000, // check every 2 seconds
        aggregateTimeout: 300, // wait before rebuilding
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
