import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AppShell } from "./AppShell";

/**
 * Responsive / layout component tests for the application shell (task 12.2).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 11.2, 16.3, 16.4
 *
 * NOTE ON RESPONSIVE ASSERTIONS:
 * jsdom has no layout/CSS engine and Tailwind's stylesheet is not loaded during
 * tests, so `getComputedStyle` cannot report real pixel widths, media-query
 * results, or `display:none` from utility classes. We therefore assert the
 * *documented Tailwind responsive class hooks* that drive each arrangement
 * (e.g. `md:hidden` on the mobile launcher, `md:block` on the side-pane panels,
 * `md:static` / `md:translate-y-0` on the sheet, `overflow-hidden` /
 * `max-w-[100vw]` on the root) rather than computed pixel geometry. These
 * classes are what produce the 320-1920px behaviour in a real browser. The
 * viewport width is still varied via `window.innerWidth` to document the
 * breakpoints the layout targets (320, 375, 768, 1920px).
 *
 * Touch-target sizing (Req 16.4): Tailwind `min-h-11`/`min-w-11` resolve to the
 * spacing-scale value 11 = 2.75rem = 44px (2.75 * 16). We assert these classes
 * are present on every launcher control rather than measuring pixels, for the
 * same jsdom-layout reason noted above.
 */

/** The four secondary-panel launchers plus the always-present map access point. */
const LAUNCHER_TEST_IDS = [
  "launcher-map",
  "launcher-scaffoldInputs",
  "launcher-materialList",
  "launcher-aiAssistant",
  "launcher-export",
] as const;

/** Breakpoints called out by task 12.2 (mobile small, mobile, tablet, desktop). */
const VIEWPORT_WIDTHS = [320, 375, 768, 1920] as const;

/** Set the jsdom viewport width and notify listeners (documents the breakpoint). */
function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
    writable: true,
  });
  window.dispatchEvent(new Event("resize"));
}

/** Renders the shell with simple, identifiable placeholder slot content. */
function renderShell() {
  return render(
    <AppShell
      map={<div data-testid="slot-map">MAP</div>}
      scaffoldInputs={<div data-testid="slot-inputs">INPUTS</div>}
      materialList={<div data-testid="slot-materials">MATERIALS</div>}
      aiAssistant={<div data-testid="slot-assistant">ASSISTANT</div>}
      exportActions={<div data-testid="slot-export">EXPORT</div>}
    />,
  );
}

/** A wrapper that places a controlled text input inside the scaffoldInputs slot
 *  so we can prove page state survives opening/closing the sheet (Req 1.4). */
function ShellWithStatefulInput() {
  const [value, setValue] = useState("");
  return (
    <AppShell
      map={<div data-testid="slot-map">MAP</div>}
      scaffoldInputs={
        <input
          data-testid="working-height"
          aria-label="Working height"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      }
      materialList={<div data-testid="slot-materials">MATERIALS</div>}
      aiAssistant={<div data-testid="slot-assistant">ASSISTANT</div>}
      exportActions={<div data-testid="slot-export">EXPORT</div>}
    />
  );
}

afterEach(() => {
  cleanup();
  setViewportWidth(1024); // reset to a neutral default between tests
});

describe("AppShell access points (Req 1.5)", () => {
  it("exposes all five access points: map plus the four panel launchers", () => {
    renderShell();
    for (const id of LAUNCHER_TEST_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // The launcher bar itself is the navigation surface for these access points.
    expect(screen.getByTestId("mobile-launcher")).toBeInTheDocument();
  });

  it("renders every slot's content so all features are reachable from one page", () => {
    renderShell();
    expect(screen.getByTestId("slot-map")).toBeInTheDocument();
    expect(screen.getByTestId("slot-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("slot-materials")).toBeInTheDocument();
    expect(screen.getByTestId("slot-assistant")).toBeInTheDocument();
    expect(screen.getByTestId("slot-export")).toBeInTheDocument();
  });
});

describe("Bottom sheet open/dismiss (Req 1.2)", () => {
  it("is closed initially (sheet translated off-screen, backdrop hidden)", () => {
    renderShell();
    const sheet = screen.getByTestId("mobile-bottom-sheet");
    const backdrop = screen.getByTestId("bottom-sheet-backdrop");
    // Closed => translated fully down and not the open transform.
    expect(sheet.className).toContain("translate-y-full");
    expect(sheet.className).not.toContain("translate-y-0 ");
    // Backdrop is removed from the a11y tree / not interactive when closed.
    expect(backdrop).toHaveAttribute("hidden");
  });

  it("opens the sheet when a launcher is clicked", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId("launcher-scaffoldInputs"));

    const sheet = screen.getByTestId("mobile-bottom-sheet");
    expect(sheet.className).toContain("translate-y-0");
    // The launcher reflects the open/active panel state for assistive tech.
    expect(screen.getByTestId("launcher-scaffoldInputs")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Backdrop becomes active (no longer hidden) while the sheet is open.
    expect(screen.getByTestId("bottom-sheet-backdrop")).not.toHaveAttribute(
      "hidden",
    );
  });

  it("dismisses the sheet via the close button", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId("launcher-aiAssistant"));
    expect(screen.getByTestId("mobile-bottom-sheet").className).toContain(
      "translate-y-0",
    );

    await user.click(screen.getByTestId("bottom-sheet-close"));

    const sheet = screen.getByTestId("mobile-bottom-sheet");
    expect(sheet.className).toContain("translate-y-full");
    expect(screen.getByTestId("bottom-sheet-backdrop")).toHaveAttribute("hidden");
  });

  it("dismisses the sheet via the map access point", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId("launcher-export"));
    expect(screen.getByTestId("mobile-bottom-sheet").className).toContain(
      "translate-y-0",
    );

    // Tapping "Map" returns focus to the always-visible primary pane (Req 1.5).
    await user.click(screen.getByTestId("launcher-map"));
    expect(screen.getByTestId("mobile-bottom-sheet").className).toContain(
      "translate-y-full",
    );
    expect(screen.getByTestId("launcher-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("Page state preserved when toggling the sheet (Req 1.4)", () => {
  it("retains an entered input value across opening and closing the sheet", async () => {
    const user = userEvent.setup();
    render(<ShellWithStatefulInput />);

    const input = screen.getByTestId("working-height") as HTMLInputElement;
    await user.type(input, "12.5");
    expect(input.value).toBe("12.5");

    // Open the inputs panel, then close it again.
    await user.click(screen.getByTestId("launcher-scaffoldInputs"));
    await user.click(screen.getByTestId("bottom-sheet-close"));

    // The same React instance survives the toggle, so the value persists.
    expect(
      (screen.getByTestId("working-height") as HTMLInputElement).value,
    ).toBe("12.5");
  });
});

describe("Touch-target sizing >=44x44 CSS px (Req 16.4)", () => {
  it("every launcher control carries the 44px (min-h-11/min-w-11) touch-target classes", () => {
    renderShell();
    for (const id of LAUNCHER_TEST_IDS) {
      const btn = screen.getByTestId(id);
      // Tailwind scale 11 = 2.75rem = 44px at the default 16px root font size.
      expect(btn.className).toContain("min-h-11");
      expect(btn.className).toContain("min-w-11");
    }
  });

  it("the bottom-sheet close button is a 44x44 target (h-11 w-11)", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId("launcher-materialList"));
    const close = screen.getByTestId("bottom-sheet-close");
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
  });
});

describe("Responsive arrangement across 320/375/768/1920px (Req 1.1, 1.2, 1.3, 11.2, 16.3)", () => {
  // The DOM is identical across widths by design (one tree restyled with
  // responsive classes), so the documented class hooks must be present at every
  // breakpoint. We render once per width to document the targeted breakpoints.
  it.each(VIEWPORT_WIDTHS)(
    "presents the documented responsive class hooks at %ipx",
    (width) => {
      setViewportWidth(width);
      renderShell();
      expect(window.innerWidth).toBe(width);

      // Root clamps the app to the viewport and clips page overflow so
      // mouse/touch scrolling cannot move the whole app out of view.
      const shell = screen.getByTestId("app-shell");
      expect(shell.className).toContain("h-[100dvh]");
      expect(shell.className).toContain("max-h-[100dvh]");
      expect(shell.className).toContain("overflow-hidden");
      expect(shell.className).toContain("max-w-[100vw]");

      const mapRegion = document.querySelector('[data-region="map"]');
      expect(mapRegion).not.toBeNull();
      expect(mapRegion?.className).toContain("overflow-hidden");

      // Mobile single-column launcher is hidden at the desktop breakpoint
      // (md:hidden) -> only shown for 320-767px (Req 1.2).
      expect(screen.getByTestId("mobile-launcher").className).toContain(
        "md:hidden",
      );

      // The sheet becomes an always-visible static side pane at >=768px
      // (md:static + md:translate-y-0), giving the multi-pane arrangement
      // (Req 1.3); on mobile it is a fixed bottom overlay.
      const sheet = screen.getByTestId("mobile-bottom-sheet");
      expect(sheet.className).toContain("md:static");
      expect(sheet.className).toContain("md:translate-y-0");
      expect(sheet.className).toContain("overflow-hidden");
      expect(sheet.className).toContain("md:min-h-0");

      const scrollArea = screen.getByTestId("bottom-sheet-scroll-area");
      expect(scrollArea.className).toContain("min-h-0");
      expect(scrollArea.className).toContain("overflow-y-auto");
      expect(scrollArea.className).toContain("overscroll-contain");

      // Each secondary panel is shown simultaneously at >=768px (md:block)
      // while only the active one shows on mobile (Req 1.3, and Req 11.2 for
      // the material-list panel's reachability across widths). The detailed
      // table-vs-cards switch for the material list lives in the MaterialList
      // component's own tests.
      const materialPanel = document.querySelector(
        '[data-region="materialList"]',
      );
      expect(materialPanel).not.toBeNull();
      expect(materialPanel?.className).toContain("md:block");
    },
  );

  it("hosts every secondary panel in the sheet for the multi-pane (desktop) arrangement (Req 1.3)", () => {
    setViewportWidth(1920);
    renderShell();
    const sheet = screen.getByTestId("mobile-bottom-sheet");
    // All four secondary panels are present inside the single side-pane host.
    for (const region of [
      "scaffoldInputs",
      "materialList",
      "aiAssistant",
      "export",
    ]) {
      expect(
        within(sheet).getByText(
          // each placeholder renders distinct text
          region === "scaffoldInputs"
            ? "INPUTS"
            : region === "materialList"
              ? "MATERIALS"
              : region === "aiAssistant"
                ? "ASSISTANT"
                : "EXPORT",
        ),
      ).toBeInTheDocument();
    }
  });
});
