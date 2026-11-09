/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser calls this app's own /api/*, which is proxied to the Express API
  // (app/api/[...path]/route.js). See frontend/lib/server-env.js for the target.
  output: 'standalone',
  // Keep the workspace shared package outside the webpack bundle (CommonJS).
  serverExternalPackages: ['@appkings/shared'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
