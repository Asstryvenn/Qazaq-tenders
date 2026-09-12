/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdf.js references the optional node-canvas package; it is never used in the browser.
    config.resolve.alias.canvas = false;
    return config;
  },
};
export default nextConfig;
