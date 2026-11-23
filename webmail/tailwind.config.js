import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        affin: {
          blue: "#2563EB",
          dark: "#0B0F19",
          surface: "#111827",
        },
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        light: {
          "primary": "#2563EB",
          "primary-content": "#FFFFFF",
          "secondary": "#475569",
          "accent": "#0D9488",
          "neutral": "#1E293B",
          "base-100": "#FFFFFF",
          "base-200": "#F8FAFC",
          "base-300": "#F1F5F9",
          "base-content": "#0F172A",
          "info": "#0284C7",
          "success": "#16A34A",
          "warning": "#D97706",
          "error": "#DC2626",
        },
        dark: {
          "primary": "#3B82F6",
          "primary-content": "#FFFFFF",
          "secondary": "#9CA3AF",
          "accent": "#14B8A6",
          "neutral": "#0F172A",
          "base-100": "#111827",
          "base-200": "#0B0F19",
          "base-300": "#1F2937",
          "base-content": "#F9FAFB",
          "info": "#38BDF8",
          "success": "#22C55E",
          "warning": "#F59E0B",
          "error": "#EF4444",
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
  },
};
