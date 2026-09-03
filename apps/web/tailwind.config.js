/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7f6",
          100: "#d3ece9",
          500: "#1f8a80",
          600: "#187169",
          700: "#125853",
        },
      },
      // Native CSS animations only (no animation library) — see
      // app/page.tsx for where these are used. The logo's own opening
      // move (large centered -> small header spot) is a FLIP-style
      // transform set imperatively in page.tsx, not a keyframe here,
      // since it needs a per-visit-computed distance; these two remain
      // for the ambient pulsing halo behind it and the staggered fade-in
      // of the wordmark/tagline/role cards once it settles.
      keyframes: {
        "hero-ring": {
          "0%": { opacity: "0.45", transform: "translate(-50%, -50%) scale(0.5)" },
          "70%": { opacity: "0.12" },
          "100%": { opacity: "0", transform: "translate(-50%, -50%) scale(1.6)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "hero-ring": "hero-ring 1300ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in-up": "fade-in-up 480ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
