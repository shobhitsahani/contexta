/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {},
  async rewrites() {
    // Proxy API calls to the backend so cookies and relative paths work in dev/prod.
    // In production set NEXT_PUBLIC_API_URL to the backend origin; a relative rewrite
    // keeps same-origin behavior when both are on the same host.
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
