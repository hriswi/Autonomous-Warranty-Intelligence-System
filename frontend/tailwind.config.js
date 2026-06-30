/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        black:    '#000000',
        'near-black': '#0A0A0A',
        'dark':   '#111111',
        'soft-gray': '#666666',
        'light-gray': '#D9D9D9',
        white:    '#FFFFFF',
      },
      fontFamily: {
        equinox: ['Equinox', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        '10xl': ['10rem', { lineHeight: '0.9' }],
        '9xl':  ['8rem',  { lineHeight: '0.9' }],
      },
      letterSpacing: {
        tightest: '-0.05em',
        widest:   '0.25em',
      },
      backdropBlur: { xs: '2px' },
      animation: {
        'fade-up':   'fadeUp 0.6s ease forwards',
        'fade-in':   'fadeIn 0.4s ease forwards',
        'slide-in':  'slideIn 0.5s ease forwards',
        'pulse-slow':'pulseSlow 3s ease-in-out infinite',
      },
      keyframes: {
        fadeUp:    { from: { opacity: 0, transform: 'translateY(20px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        fadeIn:    { from: { opacity: 0 }, to: { opacity: 1 } },
        slideIn:   { from: { transform: 'translateX(-20px)', opacity: 0 }, to: { transform: 'translateX(0)', opacity: 1 } },
        pulseSlow: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
      },
    },
  },
  plugins: [],
};
