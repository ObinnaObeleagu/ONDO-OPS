/** @type {import('next').NextConfig} */
const nextConfig = {
  // The agent screen is used on low-end phones on weak connections in the
  // field. Keep this app server-rendered and light rather than reaching
  // for a heavier client framework.
  reactStrictMode: true,
};

module.exports = nextConfig;
