import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  type BoundFunctions,
  type queries,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { MaterialList } from "./MaterialList";
import type { MaterialItem, UpdateResult } from "@/lib/types";

/**
 * Unit tests for the MaterialList quantity-validation UI branch (task 15.5).
 *
 * Validates: Requirements 11.6
 *
 * Req 11.6: when the user enters a non-integer, negative, or out-of-range
 * quantity the value is rejected, the prior quantity is retained, and a
 * validation message identifying the invalid item is shown. The same rejection
 * messaging is surfaced when the controller-backed `onQuantityChange` prop
 * returns an `UpdateResult` with `ok: false`.
 *
 * The component renders its quantity input twice (a table at >=768px and cards
 * below it), so every interaction and assertion is scoped to the table
 * container to avoid the intentionally duplicated test ids.
 */

const ITEMS: MaterialItem[] = [
  { id: "frames", itemName: "Frames / standards", quantity: 24, unit: "pcs" },
  { id: "ledgers", itemName: "Ledgers / horizontals", quantity: 12, unit: "pcs" },
];

const MIN_QUANTITY = 0;
const MAX_QUANTITY = 999999;

/**
 * Harness mirroring the relevant slice of the Project_State controller: a valid
 * integer in 0..999999 is stored; anything else is rejected with a field
 * identifying {@link UpdateResult}. The component performs its own local
 * validation first, so this is reached only for values that pass that check —
 * unless `rejectAll` forces every commit to be rejected to exercise the
 * controller-driven rejection path (Req 11.6).
 */
function MaterialListHarness({ rejectAll = false }: { rejectAll?: boolean }) {
  const [items, setItems] = useState<MaterialItem[]>(ITEMS);

  const onQuantityChange = (itemId: string, qty: number): UpdateResult => {
    const target = items.find((item) => item.id === itemId);
    const valid =
      !rejectAll &&
      Number.isInteger(qty) &&
      qty >= MIN_QUANTITY &&
      qty <= MAX_QUANTITY;

    if (!valid) {
      // Reject without mutating state: the prior quantity is retained (Req 11.6).
      return {
        ok: false,
        error: {
          field: `materialQuantity:${itemId}`,
          message: `The quantity for "${target?.itemName ?? itemId}" was rejected.`,
        },
      };
    }

    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, quantity: qty } : item)),
    );
    return { ok: true };
  };

  return (
    <div>
      <MaterialList
        calculation={null}
        materialListAdjusted={items}
        scaffoldLengthMeters={42}
        decimalPlaces={2}
        onQuantityChange={onQuantityChange}
      />
      {/* Authoritative stored quantities, used to prove retention on rejection. */}
      {items.map((item) => (
        <span key={item.id} data-testid={`stored-qty-${item.id}`}>
          {item.quantity}
        </span>
      ))}
    </div>
  );
}

/** Scopes queries to the desktop table, where each test id appears exactly once. */
function table(): BoundFunctions<typeof queries> {
  return within(screen.getByTestId("material-list-table"));
}

afterEach(() => {
  cleanup();
});

describe("MaterialList quantity validation messaging (Req 11.6)", () => {
  it("rejects a negative quantity with an item-identifying message and retains the prior quantity", async () => {
    const user = userEvent.setup();
    render(<MaterialListHarness />);

    const input = table().getByTestId(
      "material-qty-input-frames",
    ) as HTMLInputElement;

    await user.clear(input);
    await user.type(input, "-5");

    const error = table().getByTestId("material-qty-error-frames");
    expect(error).toBeInTheDocument();
    // Message identifies the specific invalid item (Req 11.6).
    expect(error).toHaveTextContent(/Frames \/ standards/);

    // The prior, authoritative quantity is retained (no commit happened).
    expect(screen.getByTestId("stored-qty-frames")).toHaveTextContent("24");
    // Sibling rows are unaffected.
    expect(
      table().queryByTestId("material-qty-error-ledgers"),
    ).not.toBeInTheDocument();
  });

  it("rejects a non-integer quantity with an item-identifying message and retains the prior quantity", async () => {
    const user = userEvent.setup();
    render(<MaterialListHarness />);

    const input = table().getByTestId(
      "material-qty-input-frames",
    ) as HTMLInputElement;

    await user.clear(input);
    await user.type(input, ".5");

    const error = table().getByTestId("material-qty-error-frames");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/whole number/i);
    expect(error).toHaveTextContent(/Frames \/ standards/);

    expect(screen.getByTestId("stored-qty-frames")).toHaveTextContent("24");
  });

  it("rejects an out-of-range quantity (> 999999) with an item-identifying message", async () => {
    const user = userEvent.setup();
    render(<MaterialListHarness />);

    const input = table().getByTestId(
      "material-qty-input-ledgers",
    ) as HTMLInputElement;

    await user.clear(input);
    await user.type(input, "1000000");

    const error = table().getByTestId("material-qty-error-ledgers");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/Ledgers \/ horizontals/);
    // The invalid value is never committed as the stored quantity.
    expect(screen.getByTestId("stored-qty-ledgers")).not.toHaveTextContent(
      "1000000",
    );
  });

  it("surfaces the controller's rejection message when onQuantityChange returns ok:false and retains the prior quantity", async () => {
    const user = userEvent.setup();
    render(<MaterialListHarness rejectAll />);

    const input = table().getByTestId(
      "material-qty-input-frames",
    ) as HTMLInputElement;

    // A locally valid integer passes the component's own check and is forwarded
    // to the controller, which rejects it via UpdateResult { ok: false }.
    await user.clear(input);
    await user.type(input, "7");

    const error = table().getByTestId("material-qty-error-frames");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/was rejected/i);
    expect(error).toHaveTextContent(/Frames \/ standards/);

    // Rejected by the controller -> the prior quantity is retained (Req 11.6).
    expect(screen.getByTestId("stored-qty-frames")).toHaveTextContent("24");
  });

  it("accepts a valid integer quantity, clearing any prior validation message", async () => {
    const user = userEvent.setup();
    render(<MaterialListHarness />);

    const input = table().getByTestId(
      "material-qty-input-frames",
    ) as HTMLInputElement;

    await user.clear(input);
    await user.type(input, "30");

    expect(
      table().queryByTestId("material-qty-error-frames"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("stored-qty-frames")).toHaveTextContent("30");
  });
});
