import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

// Unit tests for graceful PWA degradation (task 17.2, Req 16.5).
// When the browser does not support service workers, rendering the component
// must not throw and must not attempt any registration. The app then keeps
// running as a plain responsive web app.

/** Temporarily removes `serviceWorker` from `navigator` for a single test. */
function withoutServiceWorker(run: () => void) {
  const nav = navigator as Navigator & { serviceWorker?: unknown };
  const had = Object.prototype.hasOwnProperty.call(nav, "serviceWorker");
  const original = nav.serviceWorker;
  // Ensure `'serviceWorker' in navigator` is false (unsupported browser).
  delete (nav as { serviceWorker?: unknown }).serviceWorker;
  try {
    run();
  } finally {
    if (had) {
      Object.defineProperty(nav, "serviceWorker", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  }
}

describe("ServiceWorkerRegister graceful degradation (Req 16.5)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not throw when service workers are unsupported", () => {
    withoutServiceWorker(() => {
      expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
    });
  });

  it("renders nothing (no DOM output)", () => {
    withoutServiceWorker(() => {
      const { container } = render(<ServiceWorkerRegister />);
      expect(container.childElementCount).toBe(0);
      expect(container.textContent).toBe("");
    });
  });

  it("does not attempt registration when service workers are unsupported", () => {
    // A register spy is attached, then serviceWorker is removed so support
    // detection fails. The spy must never be invoked.
    const register = vi.fn();
    const nav = navigator as Navigator & { serviceWorker?: unknown };
    const had = Object.prototype.hasOwnProperty.call(nav, "serviceWorker");
    const original = nav.serviceWorker;

    Object.defineProperty(nav, "serviceWorker", {
      value: { register },
      configurable: true,
      writable: true,
    });
    delete (nav as { serviceWorker?: unknown }).serviceWorker;

    try {
      render(<ServiceWorkerRegister />);
      expect(register).not.toHaveBeenCalled();
    } finally {
      if (had) {
        Object.defineProperty(nav, "serviceWorker", {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});
