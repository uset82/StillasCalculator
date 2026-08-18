import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["'Newsreader'", "Charter", "Georgia", "serif"],
        sans: ["'Plus Jakarta Sans'", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
        display: ["'Newsreader'", "Charter", "Georgia", "serif"],
      },
      screens: {
        // Design breakpoint: mobile < 768px, desktop >= 768px (Req 1.2, 1.3)
        md: "768px",
      },
      colors: {
        clay: {
          50: "#fdf8f5",
          100: "#f9eee8",
          200: "#f4ddd3",
          300: "#ecc4b4",
          400: "#e1a28a",
          500: "#da7756",
          600: "#c25e3d",
          700: "#a3482a",
          800: "#843922",
          900: "#6d301f",
        },
        sand: {
          50: "#faf8f5",
          100: "#f5f2eb",
          200: "#eee9de",
          300: "#dfdad1",
          400: "#c4bdaf",
          500: "#a8a090",
          600: "#78736d",
          700: "#57534e",
          800: "#2d2a26",
          900: "#1a1918",
          950: "#141312",
        },
        brand: {
          50: "#fdf8f5",
          100: "#f9eee8",
          200: "#f4ddd3",
          300: "#ecc4b4",
          400: "#e1a28a",
          500: "#da7756",
          600: "#c25e3d",
          700: "#a3482a",
          800: "#843922",
          900: "#6d301f",
          950: "#451c11",
        },
        safety: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
      },
      boxShadow: {
        "hud": "0 8px 32px 0 rgba(26, 25, 24, 0.08)",
        "card": "0 1px 3px 0 rgba(26, 25, 24, 0.04), 0 1px 2px -1px rgba(26, 25, 24, 0.04)",
        "card-hover": "0 8px 24px -4px rgba(26, 25, 24, 0.08), 0 2px 6px -2px rgba(26, 25, 24, 0.04)",
        "clay": "0 4px 14px 0 rgba(218, 119, 86, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
