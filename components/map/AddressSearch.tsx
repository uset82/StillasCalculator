"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { GeocodingResult } from "@/lib/types";
import {
  createDebouncedGeocoder,
  type DebouncedGeocoder,
  type DebouncedGeocoderDeps,
  type GeocodeOutcome,
} from "@/lib/geocoding/photon";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components in this project.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Message shown when both providers fail to return a match (Req 3.7). */
const NO_MATCH_MESSAGE = "No matching address was found.";

/** Message shown when requests are throttled (Req 3.8). */
const RATE_LIMITED_MESSAGE =
  "Too many searches at once. Please wait a moment and try again.";

/** Fallback message for transport/parse failures. */
const ERROR_MESSAGE = "Address search could not be completed. Please try again.";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddressSearchProps {
  /**
   * Invoked when the user selects a suggestion. Wire this so the parent centers
   * the map on the coordinate and places the single search marker, replacing
   * any previous marker (Req 3.4, 3.5) — typically by calling
   * `projectStateController.setAddress` and feeding the coordinate to
   * `MapView`'s `marker` prop.
   */
  onSelectAddress: (result: GeocodingResult) => void;
  /**
   * Optional injectable geocoder dependencies (fetch/clock/scheduler), used to
   * make timing and network deterministic under test. Defaults to the real
   * browser implementations. Read once when the geocoder is created.
   */
  geocoderDeps?: DebouncedGeocoderDeps;
  /** Placeholder text for the search input. */
  placeholder?: string;
  /** Accessible label for the search input. */
  label?: string;
  /** Extra classes for the root container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Debounced address search with a selectable suggestion list (Req 3).
 *
 * Responsibilities owned here:
 * - Wires a text input to the debounced client geocoding adapter so a request
 *   is issued only after at least 3 characters and a 300 ms idle pause, while
 *   shorter inputs clear suggestions and issue nothing (Req 3.1, 3.2). The
 *   adapter also enforces the per-session client rate limit (Req 3.8).
 * - Renders up to the first 5 returned suggestions in a selectable list
 *   (Req 3.3).
 * - On selection, invokes {@link AddressSearchProps.onSelectAddress} so the
 *   parent can center the map and place the single marker (Req 3.4, 3.5), then
 *   collapses the list and reflects the chosen label in the input.
 * - On a no-match outcome, shows the "no matching address" message; the parent
 *   preserves the current map view and existing marker by simply not reacting
 *   to a non-selection (Req 3.7).
 *
 * This is a controlled presentation component: it owns the input draft and the
 * displayed suggestions/status, but defers the actual map/state mutation to the
 * `onSelectAddress` callback so it can be wired to `Project_State`/`MapView`
 * later (tasks 13.x, 18.1).
 */
export function AddressSearch({
  onSelectAddress,
  geocoderDeps,
  placeholder = "Search for an address",
  label = "Address search",
  className,
}: AddressSearchProps) {
  const inputId = useId();
  const listboxId = `${inputId}-suggestions`;
  const statusId = `${inputId}-status`;

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // The debounced geocoder is created once and bound to the state setters. The
  // setters are stable, so the handlers never need to be rebuilt.
  const geocoderRef = useRef<DebouncedGeocoder | null>(null);
  // Capture the initial deps so the geocoder can be created lazily once.
  const depsRef = useRef(geocoderDeps);
  depsRef.current = geocoderDeps;

  // `onSelectAddress` is read through a ref so a changing callback identity
  // never forces the geocoder/effects to be rebuilt.
  const onSelectRef = useRef(onSelectAddress);
  onSelectRef.current = onSelectAddress;

  useEffect(() => {
    const geocoder = createDebouncedGeocoder(
      {
        onOutcome: handleOutcome,
        onClearSuggestions: () => {
          setSuggestions([]);
          setStatusMessage(null);
          setActiveIndex(-1);
        },
      },
      depsRef.current,
    );
    geocoderRef.current = geocoder;
    return () => {
      geocoder.cancel();
      geocoderRef.current = null;
    };
    // Created once on mount; deps/handlers are captured via refs/stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Maps a completed search outcome onto the suggestions/status UI (Req 3). */
  function handleOutcome(outcome: GeocodeOutcome): void {
    setActiveIndex(-1);
    switch (outcome.status) {
      case "gated":
        // Too short: suggestions cleared, no message (Req 3.2).
        setSuggestions([]);
        setStatusMessage(null);
        return;
      case "ok":
        // Up to the first 5 suggestions (already truncated by the adapter, Req 3.3).
        setSuggestions(outcome.results);
        setStatusMessage(null);
        return;
      case "no-match":
        // Preserve the current view/marker; just surface the message (Req 3.7).
        setSuggestions([]);
        setStatusMessage(NO_MATCH_MESSAGE);
        return;
      case "rate-limited":
        setSuggestions([]);
        setStatusMessage(RATE_LIMITED_MESSAGE);
        return;
      case "error":
      default:
        setSuggestions([]);
        setStatusMessage(outcome.message ?? ERROR_MESSAGE);
        return;
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setQuery(value);
    geocoderRef.current?.search(value);
  }

  function selectSuggestion(result: GeocodingResult): void {
    // Hand the selection to the parent so it can center the map and place the
    // single marker (Req 3.4, 3.5).
    onSelectRef.current(result);
    // Reflect the chosen label and collapse the list; cancel any pending search
    // so the resolved selection is not overwritten by a late response.
    geocoderRef.current?.cancel();
    setQuery(result.label);
    setSuggestions([]);
    setStatusMessage(null);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? suggestions.length - 1 : prev - 1,
        );
        return;
      case "Enter": {
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          event.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
        }
        return;
      }
      case "Escape":
        event.preventDefault();
        setSuggestions([]);
        setActiveIndex(-1);
        return;
      default:
        return;
    }
  }

  const hasSuggestions = suggestions.length > 0;

  return (
    <div
      data-testid="address-search"
      className={cn("relative flex flex-col gap-1", className)}
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        aria-label={label}
        aria-expanded={hasSuggestions}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-describedby={statusMessage ? statusId : undefined}
        data-testid="address-search-input"
        className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {/* Selectable suggestions list, up to the first 5 (Req 3.3). */}
      {hasSuggestions ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          data-testid="address-search-suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((result, index) => {
            const optionId = `${listboxId}-option-${index}`;
            const isActive = index === activeIndex;
            return (
              <li
                key={`${result.lat},${result.lon},${index}`}
                id={optionId}
                role="option"
                aria-selected={isActive}
              >
                <button
                  type="button"
                  // `onMouseDown` (not `onClick`) so selection fires before the
                  // input's blur can collapse the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSuggestion(result);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  data-testid={`address-search-suggestion-${index}`}
                  className={cn(
                    "flex min-h-11 w-full items-center px-3 py-2 text-left text-sm text-gray-900",
                    isActive ? "bg-blue-50 text-blue-900" : "hover:bg-gray-50",
                  )}
                >
                  {result.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* No-match / rate-limit / error status message (Req 3.7). */}
      {statusMessage ? (
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          data-testid="address-search-message"
          className="text-xs text-gray-600"
        >
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}

export default AddressSearch;
