/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Assistant', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
        mono: ['Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      colors: {
        sidebar: {
          DEFAULT: '#0c111d',
          hover: '#161d2e',
          active: '#1e2840',
          border: 'rgba(255,255,255,0.06)',
          text: '#9ca3af',
          'text-active': '#e2e8f0',
        },
        brand: {
          DEFAULT: '#6366f1',
          light: '#818cf8',
          dark: '#4f46e5',
          subtle: 'rgba(99,102,241,0.12)',
        },
        surface: {
          DEFAULT: '#f8fafc',
          card: '#ffffff',
          border: '#e2e8f0',
          hover: '#f1f5f9',
        },
        ink: {
          DEFAULT: '#0f172a',
          secondary: '#334155',
          muted: '#64748b',
          faint: '#94a3b8',
        },
        status: {
          clean: '#10b981',
          'clean-bg': 'rgba(16,185,129,0.1)',
          dirty: '#f59e0b',
          'dirty-bg': 'rgba(245,158,11,0.1)',
          ooo: '#ef4444',
          'ooo-bg': 'rgba(239,68,68,0.1)',
          occupied: '#3b82f6',
          'occupied-bg': 'rgba(59,130,246,0.1)',
          arrival: '#8b5cf6',
          'arrival-bg': 'rgba(139,92,246,0.1)',
          departure: '#f97316',
          'departure-bg': 'rgba(249,115,22,0.1)',
          confirmed: '#06b6d4',
          'confirmed-bg': 'rgba(6,182,212,0.1)',
          pending: '#eab308',
          'pending-bg': 'rgba(234,179,8,0.1)',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)',
        'card-hover': '0 4px 16px rgba(15,23,42,0.1), 0 2px 4px rgba(15,23,42,0.06)',
        sidebar: '2px 0 16px rgba(0,0,0,0.24)',
      },
      animation: {
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
        pulse2: 'pulse2 2s ease-in-out infinite',
      },
      keyframes: {
        slideIn: { from: { transform: 'translateX(8px)', opacity: 0 }, to: { transform: 'translateX(0)', opacity: 1 } },
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        pulse2: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } },
      },
    },
  },
  plugins: [],
};
