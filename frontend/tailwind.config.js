/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        void: {
          bg:      '#0a0a0a',
          surface: '#111111',
          border:  '#1f1f1f',
          muted:   '#3a3a3a',
          text:    '#e8e8e8',
          faint:   '#666666',
        },
        amber: {
          dim: '#b45309',
        },
      },
    },
  },
  plugins: [],
};
