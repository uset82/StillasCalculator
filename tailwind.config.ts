import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        // Design breakpoint: mobile < 768px, desktop >= 768px (Req 1.2, 1.3)
        md: "768px",
      },
    },
  },
  plugins: [],
};

export default config;
