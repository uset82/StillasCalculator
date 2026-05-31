"use client";

import { type ReactNode } from "react";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency; the layout components only need a tiny helper.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface MobileBottomSheetProps {
  /** Whether the sheet is open on mobile. Ignored at >=768px where the
   *  sheet is rendered as an always-visible side pane. */
  open: boolean;
  /** Invoked when the user dismisses the sheet (close button or backdrop). */
  onClose: () => void;
  /** Heading shown at the top of the sheet. */
  title?: string;
  /** Secondary panels hosted by the sheet (Req 1.2). */
  children: ReactNode;
  /** Extra classes for the sheet container. */
  className?: string;
}

/**
 * Openable/dismissable bottom sheet that hosts secondary panels on mobile
 * (Req 1.2) and transparently becomes an always-visible side pane at the
 * >=768px breakpoint (Req 1.3).
 *
 * The component is intentionally rendered once and restyled with Tailwind
 * responsive classes rather than conditionally mounted per breakpoint. Because
 * the same DOM subtree (and therefore the same React instances inside
 * {@link children}) survives the breakpoint change, page state such as entered
 * inputs is preserved when the viewport crosses 768px (Req 1.4).
 */
export function MobileBottomSheet({
  open,
  onClose,
  title = "Panels",
  children,
  className,
}: MobileBottomSheetProps) {
  return (
    <>
      {/* Dim backdrop, mobile-only and only while open. Tapping it dismisses
          the sheet. Hidden entirely at >=768px (md:hidden) where the sheet is
          a static pane (Req 1.3). */}
      <button
        type="button"
        aria-label="Dismiss panels"
        data-testid="bottom-sheet-backdrop"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        // Keep it out of the tab order / a11y tree when closed.
        hidden={!open}
        tabIndex={open ? 0 : -1}
      />

      <section
        data-testid="mobile-bottom-sheet"
        aria-label={title}
        // The sheet is a fixed bottom overlay on mobile and a static,
        // always-visible flex side pane on desktop.
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl transition-transform duration-300 ease-out will-change-transform",
          "md:static md:z-auto md:h-full md:min-h-0 md:max-h-full md:w-80 md:flex-none md:rounded-none md:border-l md:border-t-0 md:shadow-none md:transition-none lg:w-96",
          open ? "translate-y-0" : "translate-y-full",
          // Always shown at the desktop breakpoint regardless of `open`.
          "md:translate-y-0",
          className
        )}
      >
        {/* Mobile-only header with a grab handle and a 44x44 close target.
            Hidden on desktop where the pane is permanently visible. */}
        <div className="flex flex-col md:hidden">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-gray-300" aria-hidden="true" />
          <div className="flex items-center justify-between px-4 py-2">
            <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panels"
              data-testid="bottom-sheet-close"
              className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                &times;
              </span>
            </button>
          </div>
        </div>

        {/* Scrollable panel area. Extra bottom padding on mobile keeps the last
            panel clear of the fixed launcher bar (h-16). */}
        <div
          data-testid="bottom-sheet-scroll-area"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-20 md:pb-4"
        >
          {children}
        </div>
      </section>
    </>
  );
}

export default MobileBottomSheet;
