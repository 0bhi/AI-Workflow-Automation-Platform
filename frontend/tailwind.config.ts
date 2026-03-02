import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#020817",
        foreground: "#E2E8F0",
        primary: {
          DEFAULT: "#3B82F6",
          foreground: "#0B1120"
        },
        muted: "#1E293B",
        border: "#1E293B",
        danger: "#EF4444",
        success: "#22C55E"
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem"
      }
    }
  },
  plugins: []
};

export default config;


