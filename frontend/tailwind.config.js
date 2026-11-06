/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cinema: {
          black: 'rgb(var(--cinema-background) / <alpha-value>)',
          panel: 'rgb(var(--cinema-panel) / <alpha-value>)',
          card: 'rgb(var(--cinema-card) / <alpha-value>)',
          border: 'rgb(var(--cinema-border) / <alpha-value>)',
          muted: 'rgb(var(--cinema-muted) / <alpha-value>)',
          text: 'rgb(var(--cinema-text) / <alpha-value>)',
          strong: 'rgb(var(--cinema-strong) / <alpha-value>)',
          soft: 'rgb(var(--cinema-soft) / <alpha-value>)',
          amber: 'rgb(var(--cinema-amber) / <alpha-value>)',
          gold: 'rgb(var(--cinema-gold) / <alpha-value>)',
          accent: 'rgb(var(--cinema-accent) / <alpha-value>)',
          ink: 'rgb(var(--cinema-ink) / <alpha-value>)',
          red: 'rgb(var(--cinema-red) / <alpha-value>)',
          danger: 'rgb(var(--cinema-danger) / <alpha-value>)',
          success: 'rgb(var(--cinema-success) / <alpha-value>)',
          error: 'rgb(var(--cinema-error) / <alpha-value>)',
          notice: 'rgb(var(--cinema-notice) / <alpha-value>)',
          'success-surface': 'rgb(var(--cinema-success-surface) / <alpha-value>)',
          'error-surface': 'rgb(var(--cinema-error-surface) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        glow: 'var(--cinema-glow)',
        card: 'var(--cinema-shadow)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.85)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn .35s ease-out both',
        popIn: 'popIn .3s cubic-bezier(.68,-0.55,.27,1.55) both',
      },
    },
  },
  plugins: [],
};
