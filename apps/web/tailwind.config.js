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
      // components/SplashScreen.tsx and app/page.tsx for where these are
      // used. Kept short (<= ~500ms per step) so they read as responsive
      // polish, not something the user waits on.
      keyframes: {
        "splash-logo-in": {
          "0%": { opacity: "0", transform: "scale(0.85)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "splash-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "splash-logo-in": "splash-logo-in 600ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "splash-out": "splash-out 350ms ease-out both",
        "fade-in-up": "fade-in-up 450ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
