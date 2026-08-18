"use client";

import { type ReactNode } from "react";

/**
 * Joins conditional class names, dropping falsy values.
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
      {/* Dim backdrop with blur, mobile-only */}
      <button
        type="button"
        aria-label="Dismiss panels"
        data-testid="bottom-sheet-backdrop"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        hidden={!open}
        tabIndex={open ? 0 : -1}
      />

      <section
        data-testid="mobile-bottom-sheet"
        aria-label={title}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-slate-700/80 bg-slate-900 shadow-2xl transition-transform duration-300 ease-out will-change-transform",
          "md:static md:z-auto md:h-full md:min-h-0 md:max-h-full md:w-96 md:flex-none md:rounded-none md:border-l md:border-t-0 md:border-slate-800 md:bg-slate-900 md:shadow-none md:transition-none md:transform-none lg:w-[440px] xl:w-[480px]",
          open ? "translate-y-0" : "max-md:translate-y-full md:translate-y-0",
          className
        )}
      >
        {/* Mobile-only header with grab handle */}
        <div className="flex flex-col border-b border-slate-800 bg-slate-900/90 px-4 py-2 md:hidden">
          <div className="mx-auto mt-1 mb-2 h-1.5 w-12 rounded-full bg-slate-700" aria-hidden="true" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-brand-500"></span>
              <h2 className="text-sm font-bold tracking-tight text-white font-mono">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panels"
              data-testid="bottom-sheet-close"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <span aria-hidden="true" className="text-xl leading-none font-bold">
                &times;
              </span>
            </button>
          </div>
        </div>

        {/* Scrollable panel area */}
        <div
          data-testid="bottom-sheet-scroll-area"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 pb-24 md:p-4 md:pb-4 space-y-4"
        >
          {children}
        </div>
      </section>
    </>
  );
}

export default MobileBottomSheet;
