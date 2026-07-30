import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // WalkSafe-AI brand palette
        walksafe: {
          green: "#1B6B4A",
          "green-light": "#2A8F64",
          "green-dark": "#145236",
          red: "#C44536",
          "red-light": "#D4605A",
          orange: "#D4820A",
          "orange-light": "#E89E2E",
          blue: "#2563EB",
          "blue-light": "#4B83F0",
          nav: "#1A1A1A",
          bg: "#F7F5F0",
          "bg-warm": "#EDE9E0",
          text: "#2D2D2D",
          "text-muted": "#6B7280",
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
