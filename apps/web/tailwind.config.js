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
      // used. Durations were deliberately lengthened and given more
      // distinctive motion (bounce-in, a pulsing halo ring, staggered
      // loading dots) per the user's follow-up ask for a more premium
      // feel on the splash + role-selection transition; still pure
      // CSS/Tailwind, no animation library.
      keyframes: {
        "splash-logo-in": {
          "0%": { opacity: "0", transform: "scale(0.8)" },
          "60%": { opacity: "1", transform: "scale(1.06)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "splash-ring": {
          "0%": { opacity: "0.45", transform: "scale(0.6)" },
          "70%": { opacity: "0.12" },
          "100%": { opacity: "0", transform: "scale(1.7)" },
        },
        "splash-dot": {
          "0%, 80%, 100%": { opacity: "0.25", transform: "scale(0.8)" },
          "40%": { opacity: "1", transform: "scale(1)" },
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
        "splash-logo-in": "splash-logo-in 650ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "splash-ring": "splash-ring 1300ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "splash-dot": "splash-dot 1000ms ease-in-out infinite",
        "splash-out": "splash-out 420ms ease-out both",
        "fade-in-up": "fade-in-up 480ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
