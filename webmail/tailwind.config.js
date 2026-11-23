import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      transitionTimingFunction: {
        'unslop': 'cubic-bezier(0.22, 1, 0.36, 1)',
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
          "secondary": "#525252",
          "accent": "#0D9488",
          "neutral": "#18181B",
          "base-100": "#FFFFFF",
          "base-200": "#F4F4F5",
          "base-300": "#E4E4E7",
          "base-content": "#171717",
          "info": "#0284C7",
          "success": "#16A34A",
          "warning": "#D97706",
          "error": "#DC2626",
        },
        dark: {
          "primary": "#3B82F6",
          "primary-content": "#FFFFFF",
          "secondary": "#A1A1A6",
          "accent": "#14B8A6",
          "neutral": "#0F0F10",
          "base-100": "#19191B",
          "base-200": "#141415",
          "base-300": "#232325",
          "base-content": "#EDEDED",
          "info": "#38BDF8",
          "success": "#4CC38A",
          "warning": "#F59E0B",
          "error": "#E5484D",
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
  },
};

