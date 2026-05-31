import type { MetadataRoute } from "next";

/**
 * Web app manifest for the installable PWA (Req 16.1).
 *
 * Next.js App Router serves this file as `/manifest.webmanifest` and wires the
 * corresponding <link rel="manifest"> tag into every page automatically.
 *
 * Provides a name, a start URL, a standalone display mode, and 192x192 and
 * 512x512 app icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StillasCalculator",
    short_name: "Stillas",
    description:
      "Estimate scaffolding (stillas) material needs around a building or facade. Planning estimates require professional verification.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
