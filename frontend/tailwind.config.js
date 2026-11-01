/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cinema: {
          black: '#0b0c10',
          panel: '#12141d',
          card: '#171a26',
          border: '#232739',
          muted: '#8b8fa3',
          amber: '#f5b942',
          red: '#e63946',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(245,185,66,0.25)',
        card: '0 12px 32px rgba(0,0,0,0.45)',
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
