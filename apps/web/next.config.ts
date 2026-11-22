import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN || 'http://127.0.0.1:4000';
const url = new URL(apiOrigin);
if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash)
  throw new Error('API_ORIGIN must be an http(s) origin without a path');

const nextConfig: NextConfig = {
  async rewrites() {
    return ['auth', 'publications', 'public', 'me', 'subscriptions', 'unsubscribe'].map(
      (prefix) => ({
        source: `/api/${prefix}/:path*`,
        destination: `${url.origin}/${prefix}/:path*`,
      }),
    );
  },
};

export default nextConfig;
