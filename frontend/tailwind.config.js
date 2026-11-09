/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef5ff',
          100: '#d9e8ff',
          200: '#b7d4ff',
          300: '#83b7ff',
          400: '#4b91f2',
          500: '#2471d2',
          600: '#1558ad',
          700: '#124788',
          800: '#103768',
          900: '#0b2448',
        },
        ink: '#12213a',
        accent: {
          500: '#ff542e',
          600: '#ed4022',
          700: '#c92d16',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
