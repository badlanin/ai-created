/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // ── 深色主题表面色 ──
      backgroundColor: {
        "bg-primary": "var(--bg-primary)",
        "bg-secondary": "var(--bg-secondary)",
        "bg-tertiary": "var(--bg-tertiary)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-card": "var(--bg-card)",
        "bg-hover": "var(--bg-hover)",
      },
      // ── 文字 ──
      textColor: {
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-tertiary": "var(--text-tertiary)",
        "text-muted": "var(--text-muted)",
        "brand-400": "var(--brand-400)",
        "brand-500": "var(--brand-500)",
        "brand-600": "var(--brand-600)",
      },
      // ── 边框 ──
      borderColor: {
        "border-subtle": "var(--border-subtle)",
        "border-default": "var(--border-default)",
        "border-strong": "var(--border-strong)",
        "brand-500": "var(--brand-500)",
      },
      // ── 通用色（背景/文字/边框 一并暴露给 ring/divide 等）──
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
          elevated: "var(--bg-elevated)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
        },
        fg: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          muted: "var(--text-muted)",
        },
        bd: {
          subtle: "var(--border-subtle)",
          default: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        brand: {
          400: "var(--brand-400)",
          500: "var(--brand-500)",
          600: "var(--brand-600)",
        },
        success: "var(--success)",
        warn: "var(--warn)",
        danger: "var(--danger)",
      },
      // ── 圆角 ──
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
      },
      // ── 阴影 ──
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
        "glow-sm": "0 0 20px rgba(59, 130, 246, 0.25)",
        "focus-ring": "0 0 0 3px rgba(59, 130, 246, 0.25)",
      },
      // ── 缓动 / 时长 ──
      transitionTimingFunction: {
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "250ms",
      },
      // ── 动画 ──
      animation: {
        "fade-in": "fadeIn 150ms ease-out",
        "slide-up": "slideUp 250ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        "slide-in-right":
          "slideInRight 250ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      // ── 字体 ──
      fontFamily: {
        sans: [
          "Inter",
          '"Noto Sans SC"',
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
