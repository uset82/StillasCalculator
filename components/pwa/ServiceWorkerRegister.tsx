"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for PWA support (Req 16.2) while degrading
 * gracefully where install/service workers are unsupported (Req 16.5).
 *
 * The component renders nothing. It feature-detects `serviceWorker` support
 * before attempting registration, so browsers without PWA support simply keep
 * running the app as a normal responsive web app with no errors thrown.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Feature-detect before registering: no service worker support means the
    // app continues to operate as a plain responsive web app (Req 16.5).
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Avoid registering during development to prevent stale-cache confusion;
    // the manifest and graceful degradation still apply in all environments.
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    let cancelled = false;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures (e.g. non-HTTPS, blocked) must not break the
        // app; non-PWA features keep working regardless (Req 16.5).
      });
    };

    if (document.readyState === "complete") {
      if (!cancelled) register();
    } else {
      const onLoad = () => {
        if (!cancelled) register();
      };
      window.addEventListener("load", onLoad, { once: true });
      return () => {
        cancelled = true;
        window.removeEventListener("load", onLoad);
      };
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

export default ServiceWorkerRegister;
