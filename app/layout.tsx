import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "StillasCalculator",
  description:
    "Estimate scaffolding (stillas) material needs around a building or facade. Planning estimates require professional verification.",
  applicationName: "StillasCalculator",
  // Enables standalone launch on iOS Safari once added to the home screen
  // (Req 16.2). Android Chrome reads these signals from the web app manifest.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Stillas",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `suppressHydrationWarning` ignores top-level attribute differences that
    // browser extensions inject onto <html>/<body> before React hydrates (e.g.
    // `data-qb-installed`), which would otherwise surface as a benign but noisy
    // hydration mismatch. It only suppresses warnings one level deep.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
