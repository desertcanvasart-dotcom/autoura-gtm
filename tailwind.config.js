/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Matches getautoura.net's olive palette (autoura-saas `primary`).
        brand: {
          DEFAULT: '#647C47', // olive (primary-500)
          dark: '#536639', // primary-600 — hover
          light: '#92A873', // primary-400
        },
        // Sand/cream accent from the marketing site (autoura-saas `secondary`).
        sand: '#E9DBC8',
      },
    },
  },
  plugins: [],
}
