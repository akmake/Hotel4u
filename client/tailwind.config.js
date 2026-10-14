/** @type {import('tailwindcss').Config} */

// ── Design tokens ────────────────────────────────────────────────────────────
// All colors resolve to CSS variables defined in src/index.css (:root), stored as
// "R G B" channels so Tailwind opacity modifiers (bg-accent-500/10) keep working.
const scale = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      `rgb(var(--${name}-${step}) / <alpha-value>)`,
    ]),
  );

const accent = scale('accent');
const neutral = scale('neutral');
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Heebo', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'Consolas', 'Monaco', 'monospace'],
      },
      colors: {
        // Single system: one accent + one neutral scale.
        accent,
        neutral,
        // Legacy palettes used ad-hoc across ~160 files are folded into the system,
        // so stray `indigo-500` / `slate-600` render on-brand without touching every file.
        indigo: accent,
        violet: accent,
        purple: accent,
        slate: neutral,
        gray: neutral,
        zinc: neutral,
        stone: neutral,

        // Semantic aliases (existing class names kept for compatibility)
        brand: {
          DEFAULT: v('accent-600'),
          light: v('accent-500'),
          dark: v('accent-700'),
          subtle: 'rgb(var(--accent-600) / 0.10)',
        },
        surface: {
          DEFAULT: v('bg'),
          card: v('bg-elevated'),
          border: v('border'),
          hover: v('bg-hover'),
        },
        ink: {
          DEFAULT: v('fg'),
          secondary: v('fg-secondary'),
          muted: v('fg-muted'),
          faint: v('fg-faint'),
        },
        sidebar: {
          DEFAULT: v('bg-sidebar'),
          hover: v('bg-hover'),
          active: v('bg-active'),
          border: v('border'),
          text: v('fg-muted'),
          'text-active': v('fg'),
        },
        // Status colors carry meaning only — never decoration.
        status: {
          clean: v('success'),
          'clean-bg': 'rgb(var(--success) / 0.10)',
          dirty: v('warning'),
          'dirty-bg': 'rgb(var(--warning) / 0.12)',
          ooo: v('danger'),
          'ooo-bg': 'rgb(var(--danger) / 0.10)',
          occupied: v('info'),
          'occupied-bg': 'rgb(var(--info) / 0.10)',
          arrival: v('accent-600'),
          'arrival-bg': 'rgb(var(--accent-600) / 0.10)',
          departure: v('departure'),
          'departure-bg': 'rgb(var(--departure) / 0.10)',
          confirmed: v('accent-600'),
          'confirmed-bg': 'rgb(var(--accent-600) / 0.10)',
          pending: v('warning'),
          'pending-bg': 'rgb(var(--warning) / 0.12)',
        },
      },
      borderRadius: {
        DEFAULT: '6px',
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--neutral-900) / 0.04)',
        'card-hover': '0 4px 12px rgb(var(--neutral-900) / 0.08)',
        popover: '0 8px 24px rgb(var(--neutral-900) / 0.12), 0 2px 6px rgb(var(--neutral-900) / 0.06)',
        sidebar: 'none',
      },
      animation: {
        'slide-in': 'slideIn 0.18s ease-out',
        'fade-in': 'fadeIn 0.12s ease-out',
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
