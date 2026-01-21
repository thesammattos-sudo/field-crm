/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        field: {
          black: '#1a1a1a',
          dark: '#2a2a2a',
          gold: '#c9a87c',
          'gold-dark': '#b8860b',
          'gold-light': '#d4a574',
          stone: '#78716c',
          'stone-light': '#a8a29e',
          cream: '#fafafa',
          sand: '#f5f5f5',
        }
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-in': 'slideIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
