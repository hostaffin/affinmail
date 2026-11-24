import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gmail: {
          blue: "#0B57D0",
          'blue-hover': "#0842A0",
          'blue-light': "#C2E7FF",
          canvas: "#F6F8FC",
          search: "#EAF1FB",
          'search-hover': "#E2EAF8",
          border: "#E0E2E7",
          dark: {
            canvas: "#131314",
            surface: "#1E1F20",
            search: "#282A2C",
            'search-hover': "#333537",
            border: "#36373A",
            'blue-light': "#004A77",
            'blue-text': "#C2E7FF",
          },
        },
      },
      fontFamily: {
        sans: [
          '"Google Sans"',
          '"Roboto"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"Roboto Mono"',
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
      },
      boxShadow: {
        'gmail-modal': '0 8px 10px 1px rgba(0,0,0,0.14), 0 3px 14px 2px rgba(0,0,0,0.12), 0 5px 5px -3px rgba(0,0,0,0.2)',
      },
      transitionTimingFunction: {
        'gmail': 'cubic-bezier(0.2, 0.0, 0, 1.0)',
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        light: {
          "primary": "#0B57D0",
          "primary-content": "#FFFFFF",
          "secondary": "#444746",
          "accent": "#001D35",
          "neutral": "#1F1F1F",
          "base-100": "#FFFFFF",
          "base-200": "#F6F8FC",
          "base-300": "#E0E2E7",
          "base-content": "#1F1F1F",
          "info": "#0B57D0",
          "success": "#137333",
          "warning": "#B06000",
          "error": "#B3261E",
        },
        dark: {
          "primary": "#A8C7FA",
          "primary-content": "#042B5C",
          "secondary": "#C4C7C5",
          "accent": "#C2E7FF",
          "neutral": "#E3E3E3",
          "base-100": "#1E1F20",
          "base-200": "#131314",
          "base-300": "#36373A",
          "base-content": "#E3E3E3",
          "info": "#A8C7FA",
          "success": "#81C995",
          "warning": "#FDD663",
          "error": "#F28B82",
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
  },
};


