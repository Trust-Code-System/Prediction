import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        pitch: {
          50: "#f1f8f3",
          100: "#dcefe1",
          500: "#1f9d55",
          600: "#198248",
          700: "#15683a"
        }
      }
    }
  },
  plugins: []
};

export default config;
