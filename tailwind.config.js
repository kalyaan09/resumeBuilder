/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        app: {
          bg: "#F5F5F7",
          sidebar: "#E8E8ED",
          card: "#ffffff",
        },
        /** Light: low-alpha fill so backdrop-blur shows canvas (solid white = alpha too high) */
        surface: {
          glass: "rgba(255, 255, 255, 0.58)",
          "glass-dark": "rgba(32, 36, 48, 0.78)",
          rail: "rgba(255, 255, 255, 0.52)",
          "rail-dark": "rgba(255, 255, 255, 0.045)",
          inset: "rgba(255, 255, 255, 0.72)",
          "inset-dark": "rgba(255, 255, 255, 0.06)",
        },
        ring: {
          glass: "rgba(15, 23, 42, 0.06)",
          "glass-dark": "rgba(255, 255, 255, 0.1)",
        },
      },
      boxShadow: {
        card: "0 2px 14px rgba(15, 23, 42, 0.06)",
        "card-dark": "0 2px 18px rgba(0, 0, 0, 0.35)",
        glass:
          "0 1px 0 rgba(255,255,255,0.75) inset, 0 12px 36px rgba(15,23,42,0.08), 0 2px 12px rgba(15,23,42,0.05)",
        "glass-dark":
          "0 1px 0 rgba(255,255,255,0.06) inset, 0 14px 40px rgba(0,0,0,0.55), 0 2px 14px rgba(0,0,0,0.35)",
        /** Soft focus ring for premium controls */
        focus: "0 0 0 3px rgba(37, 99, 235, 0.28)",
      },
      borderRadius: {
        card: "12px",
        btn: "8px",
      },
    },
  },
  plugins: [],
};
