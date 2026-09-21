import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // octokit is CJS-heavy; keep it out of the bundler and require it at runtime.
  serverExternalPackages: ['octokit'],
};

export default nextConfig;
