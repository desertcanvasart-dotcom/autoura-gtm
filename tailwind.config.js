/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Autoura brand-ish neutrals; adjust to match the marketing site.
        brand: {
          DEFAULT: '#0f766e', // teal-700
          dark: '#115e59',
          light: '#14b8a6',
        },
      },
    },
  },
  plugins: [],
}
