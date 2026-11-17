/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Theme tokens (PLAN §21.3) — values live in src/index.css as CSS variables.
      colors: {
        brand: { DEFAULT: token('brand'), pressed: token('brand-pressed') },
        accent: token('brand-text'),
        'on-brand': token('on-brand'),
        bg: token('bg'),
        surface: token('surface'),
        alt: token('surface-alt'),
        line: token('border'),
        chip: { DEFAULT: token('chip'), line: token('chip-line') },
        ink: token('text'),
        muted: token('text-muted'),
        ok: token('success'),
        bad: token('danger'),
        warn: token('warning'),
      },
      fontFamily: {
        sans: ['-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
