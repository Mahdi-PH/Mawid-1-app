/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mawid/shared"],
  // Static export so the whole app is plain HTML/JS/CSS, deployable to
  // Firebase Hosting's free static-file hosting (no Cloud Functions/Cloud
  // Run needed, unlike Firebase's SSR "web frameworks" integration, which
  // requires the paid Blaze plan — see docs/firebase-setup.md for why this
  // project stays off Blaze). Every route here is already a client
  // component with no server-only data fetching, so this has no real cost
  // beyond what already changed to make it possible (see admin/layout.tsx
  // and admin/user/page.tsx's comments).
  output: "export",
};

module.exports = nextConfig;
