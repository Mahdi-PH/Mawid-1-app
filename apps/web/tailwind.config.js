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
    },
  },
  plugins: [],
};
