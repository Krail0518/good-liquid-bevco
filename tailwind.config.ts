import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#060d1a',
          2: '#0a1628',
          3: '#142238',
          4: '#1c2e48',
          5: '#243a56',
        },
        teal: {
          DEFAULT: '#00e5c0',
          2: '#00b89a',
          3: '#00c4a7',
        },
        blue: {
          brand: '#1a6fff',
        },
        gold: '#f5c842',
        muted: '#6b87ad',
      },
      fontFamily: {
        display: ['Anton', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      animation: {
        'fade-up': 'fadeUp 0.8s ease forwards',
        'slide-right': 'slideRight 0.8s ease forwards',
        'blink': 'blink 2s ease infinite',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'none' },
        },
        slideRight: {
          from: { opacity: '0', transform: 'translateX(-20px)' },
          to: { opacity: '1', transform: 'none' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.2' },
        },
      },
    },
  },
  plugins: [],
}
export default config
