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
        // Warm neutral scale from the marketing site (autoura-saas `--gray-*`).
        warm: {
          50: '#FAFAF8',
          100: '#F2F2EF',
          200: '#E6E6E1',
          300: '#D1D1C8',
          400: '#A8A89C',
          500: '#78786F',
          600: '#55554E',
          700: '#3C3C36',
          800: '#262622',
          900: '#141412',
        },
      },
    },
  },
  plugins: [],
}
