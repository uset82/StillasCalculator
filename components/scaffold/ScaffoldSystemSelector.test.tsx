import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ScaffoldSystemSelector } from "./ScaffoldSystemSelector";
import { getScaffoldSystem } from "@/lib/scaffold/scaffoldSystems";
import type { DimensionField, ScaffoldSystemId } from "@/lib/types";

/**
 * Unit tests for the ScaffoldSystemSelector UI branches (task 15.5).
 *
 * Validates: Requirements 7.4, 7.5
 *
 * - Req 7.4: selecting a placeholder system surfaces the non-certified notice.
 * - Req 7.5: with Custom Dimensions, an absent dimension surfaces a
 *   required-value message — both when the user empties a field locally and
 *   when the parent flags a dimension as missing at calculation time.
 *
 * The component is a controlled presentation component, so a small stateful
 * harness mirrors the relevant slice of the Project_State controller: selecting
 * a system loads that system's default dimensions (Req 7.2), and a committed
 * dimension edit updates the stored value.
 */

function SelectorHarness() {
  const [systemId, setSystemId] = useState<ScaffoldSystemId | null>(null);
  const [bay, setBay] = useState<number | null>(null);
  const [lift, setLift] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  const handleSelect = (id: ScaffoldSystemId) => {
    setSystemId(id);
    const system = getScaffoldSystem(id);
    if (system) {
      // Mirror Req 7.2: selecting a system loads its default dimensions.
      setBay(system.defaultBayLengthMeters);
      setLift(system.defaultLiftHeightMeters);
      setWidth(system.defaultScaffoldWidthMeters);
    }
  };

  const handleDimension = (field: DimensionField, value: number) => {
    if (field === "bayLengthMeters") setBay(value);
    else if (field === "liftHeightMeters") setLift(value);
    else setWidth(value);
  };

  return (
    <ScaffoldSystemSelector
      selectedSystemId={systemId}
      bayLengthMeters={bay}
      liftHeightMeters={lift}
      scaffoldWidthMeters={width}
      onSelectSystem={handleSelect}
      onChangeDimension={handleDimension}
    />
  );
}

/** Clicks the radio inside the option for `id`, selecting that system. */
async function selectSystem(
  user: ReturnType<typeof userEvent.setup>,
  id: ScaffoldSystemId,
): Promise<void> {
  const option = screen.getByTestId(`scaffold-system-option-${id}`);
  await user.click(within(option).getByRole("radio"));
}

afterEach(() => {
  cleanup();
});

describe("ScaffoldSystemSelector placeholder notice (Req 7.4)", () => {
  it("shows no placeholder notice before a system is selected", () => {
    render(<SelectorHarness />);
    expect(screen.queryByTestId("placeholder-notice")).not.toBeInTheDocument();
  });

  it("shows the non-certified notice when a placeholder system (HAKI) is selected", async () => {
    const user = userEvent.setup();
    render(<SelectorHarness />);

    await selectSystem(user, "haki");

    const notice = screen.getByTestId("placeholder-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/non-certified/i);
    expect(notice).toHaveTextContent(/placeholder/i);
  });

  it("does not show the placeholder notice for a non-placeholder system (Generic Frame)", async () => {
    const user = userEvent.setup();
    render(<SelectorHarness />);

    await selectSystem(user, "generic-frame");

    expect(screen.queryByTestId("placeholder-notice")).not.toBeInTheDocument();
  });
});

describe("ScaffoldSystemSelector Custom Dimensions required-value messaging (Req 7.5)", () => {
  it("surfaces a required-dimension message when a Custom Dimensions value is cleared", async () => {
    const user = userEvent.setup();
    render(<SelectorHarness />);

    // Selecting Custom Dimensions loads its defaults (Req 7.2), so the bay
    // length starts populated and free of any required-value message.
    await selectSystem(user, "custom");
    const bayInput = screen.getByTestId(
      "dimension-input-bayLengthMeters",
    ) as HTMLInputElement;
    expect(bayInput.value).not.toBe("");
    expect(
      screen.queryByTestId("dimension-error-bayLengthMeters"),
    ).not.toBeInTheDocument();

    // Emptying the field makes the dimension absent -> required-value message.
    await user.clear(bayInput);

    const error = screen.getByTestId("dimension-error-bayLengthMeters");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/required/i);
    expect(error).toHaveTextContent(/bay length/i);
  });

  it("surfaces a required-dimension message for a parent-flagged missing dimension at calculation time", () => {
    // The parent (e.g. on a calculation request) flags Bay length as missing
    // even though the other dimensions are present (Req 7.5).
    render(
      <ScaffoldSystemSelector
        selectedSystemId="custom"
        bayLengthMeters={3}
        liftHeightMeters={2}
        scaffoldWidthMeters={0.7}
        onSelectSystem={() => {}}
        onChangeDimension={() => {}}
        missingDimensions={["bayLengthMeters"]}
      />,
    );

    const error = screen.getByTestId("dimension-error-bayLengthMeters");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/required/i);

    // Dimensions that were not flagged surface no required-value message.
    expect(
      screen.queryByTestId("dimension-error-liftHeightMeters"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dimension-error-scaffoldWidthMeters"),
    ).not.toBeInTheDocument();
  });
});
