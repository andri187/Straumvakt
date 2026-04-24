import type { Config } from "tailwindcss";

/**
 * Straumvakt — brand theme
 *
 * Mark: green → blue gradient on deep navy.
 * Text: near-white on navy; lighter blue accent for tagline/links.
 *
 * Token groups:
 *   bg.*   — page/surface layers (dark)
 *   sv.*   — brand stroke colors (green top, blue bottom)
 *   ink.*  — neutral text/border scale mapped for dark theme
 *   brand.* — primary interactive accent (blue leg of the gradient)
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#070B16",
          surface: "#0B1220",
          raised: "#111A2E",
          inset: "#0E1626",
          border: "#1E2A44",
          ring: "#2B3A5E",
        },
        sv: {
          green: "#3EE9A7",
          teal: "#2BD3C9",
          blue: "#2BB6E8",
          sky: "#6FB8F0",
          mint: "#8EF5C7",
          cyan: "#6FDCEA",
        },
        brand: {
          50: "#E8F6FF",
          100: "#CDEAFD",
          200: "#9BD6FB",
          300: "#6FC4F7",
          400: "#44B2EE",
          500: "#2BB6E8",
          600: "#1E97C6",
          700: "#16789F",
          800: "#105A78",
          900: "#0B3E54",
        },
        ink: {
          50: "#F5F7FA",
          100: "#E5EAF2",
          200: "#C8D1E0",
          300: "#97A3B8",
          400: "#6B7791",
          500: "#4B566D",
          600: "#2F3A52",
          700: "#1E2A44",
          800: "#111A2E",
          900: "#0B1220",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(135deg, #3EE9A7 0%, #2BD3C9 55%, #2BB6E8 100%)",
        "brand-halo":
          "radial-gradient(80% 60% at 50% 0%, rgba(43,182,232,0.18) 0%, rgba(62,233,167,0.08) 35%, rgba(7,11,22,0) 70%)",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 10px 30px -12px rgba(0,0,0,0.5)",
        glow: "0 0 0 1px rgba(43,182,232,0.35), 0 10px 40px -10px rgba(43,182,232,0.35)",
      },
      letterSpacing: {
        brand: "0.22em",
      },
    },
  },
  plugins: [],
};

export default config;
