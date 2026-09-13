/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Verification builds use NEXT_DIST_DIR=.next-verify so they never overwrite a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // "Қозғалтқыш" is a section of the landing page, not a separate route.
  async redirects() {
    return [{ source: "/engine", destination: "/#engine", permanent: false }];
  },
  webpack: (config) => {
    // pdf.js references the optional node-canvas package; it is never used in the browser.
    config.resolve.alias.canvas = false;
    return config;
  },
};
export default nextConfig;
