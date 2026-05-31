import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ChatMessage } from "@/lib/types";
import type { AiToolResult } from "@/app/api/ai/chat/route";
import { formatMeasurement } from "@/lib/format/measurement";
import { AiChatPanel } from "./AiChatPanel";

/**
 * Component tests for the AI chat panel UI (task 16.2).
 *
 * Validates: Requirements 12.3, 13.1
 *
 * Two behaviours are covered:
 *
 *  - In-flight disabling (Req 12.3): WHILE a request is in flight the panel
 *    shows a progress indicator AND disables sending additional messages. We
 *    assert the `ai-progress-indicator` is present and that both the textarea
 *    and the send button are disabled, so no further message can leave the
 *    browser until the request settles.
 *
 *  - Engine-computed tool-result rendering (Req 13.1): a `calculateScaffoldMaterials`
 *    tool result is rendered as an `AiCalculationCard` showing the engine's
 *    quantities (bays, levels, scaffold length) and material list verbatim —
 *    nothing is invented and quantities are surfaced exactly as the engine
 *    produced them.
 *
 * jsdom has no `scrollIntoView`; `AiMessageList` calls it in an effect, so we
 * stub it for these renders.
 */

beforeAll(() => {
  // jsdom does not implement scrollIntoView, which AiMessageList invokes.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** A short, chronologically ordered conversation used by both suites. */
const SAMPLE_MESSAGES: ChatMessage[] = [
  { id: "m1", role: "user", content: "Plan my scaffold", timestamp: 1 },
  { id: "m2", role: "assistant", content: "Here are the quantities.", timestamp: 2 },
];

describe("AiChatPanel in-flight disabling (Req 12.3)", () => {
  it("shows the progress indicator and disables both the textarea and send button while pending", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        pending
      />,
    );

    // A progress indicator is displayed while the request is in flight.
    const indicator = screen.getByTestId("ai-progress-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("role", "status");

    // Sending additional messages is disabled: the composer is locked down.
    expect(screen.getByTestId("ai-input-textarea")).toBeDisabled();
    expect(screen.getByTestId("ai-send-button")).toBeDisabled();
  });

  it("does not show the progress indicator when no request is in flight", () => {
    render(
      <AiChatPanel messages={SAMPLE_MESSAGES} onSendMessage={vi.fn()} />,
    );

    expect(screen.queryByTestId("ai-progress-indicator")).not.toBeInTheDocument();
    // With no pending request the textarea is usable again.
    expect(screen.getByTestId("ai-input-textarea")).not.toBeDisabled();
  });

  it("prevents an additional send while pending (typing and clicking do not invoke onSendMessage)", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={onSendMessage}
        pending
      />,
    );

    const textarea = screen.getByTestId("ai-input-textarea");
    const sendButton = screen.getByTestId("ai-send-button");

    // The disabled textarea rejects input and the disabled button rejects clicks.
    await user.type(textarea, "another message");
    await user.click(sendButton);

    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(onSendMessage).not.toHaveBeenCalled();
  });
});

describe("AiChatPanel AI connection status", () => {
  it("shows ChatGPT/Codex account connection when the server reports Codex ChatGPT auth", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        authStatus={{
          providerPreference: "codex-cli",
          activeProvider: "codex-cli",
          canUseAssistant: true,
          openAiApiKeyConfigured: false,
          codexCli: { loggedIn: true, method: "chatgpt" },
          openAiAccountSession: {
            authenticated: true,
            pending: false,
            expiresAt: 86_400_000,
          },
          mcp: {
            connected: true,
            persistent: true,
            toolCount: 16,
            missingTools: [],
            checkedAt: 1_000,
          },
          setup: {
            chatGptSignInCommand: "codex login",
            providerEnvValue: "openai-codex",
          },
        }}
      />,
    );

    expect(screen.getByTestId("ai-auth-status")).toHaveTextContent(
      "OpenAI account + MCP tools connected",
    );
    expect(screen.getByTestId("ai-input-textarea")).not.toBeDisabled();
  });

  it("shows the Codex login command when the assistant is unavailable", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        unavailable
      />,
    );

    expect(screen.getByTestId("ai-unavailable-message")).toHaveTextContent(
      "codex login",
    );
    expect(screen.getByTestId("ai-input-textarea")).toBeDisabled();
  });

  it("requires the app user to sign in even when the host Codex CLI is already logged in", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        unavailable
        authStatus={{
          providerPreference: "codex-cli",
          activeProvider: "none",
          canUseAssistant: false,
          openAiApiKeyConfigured: false,
          codexCli: { loggedIn: true, method: "chatgpt" },
          openAiAccountSession: {
            authenticated: false,
            pending: false,
            expiresAt: null,
          },
          mcp: {
            connected: false,
            persistent: false,
            toolCount: 0,
            missingTools: [],
            checkedAt: null,
          },
          setup: {
            chatGptSignInCommand: "codex login",
            providerEnvValue: "openai-codex",
          },
        }}
        onStartChatGptSignIn={vi.fn()}
      />,
    );

    expect(screen.getByTestId("ai-auth-status")).toHaveTextContent(
      "Sign in with OpenAI to use Codex",
    );
    expect(screen.getByTestId("ai-auth-sign-in-button")).toHaveTextContent(
      "Sign in with OpenAI",
    );
    expect(screen.getByTestId("ai-input-textarea")).toBeDisabled();
  });

  it("starts the ChatGPT sign-in flow from the auth action button", async () => {
    const user = userEvent.setup();
    const onStartChatGptSignIn = vi.fn();
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        unavailable
        authStatus={{
          providerPreference: "codex-cli",
          activeProvider: "none",
          canUseAssistant: false,
          openAiApiKeyConfigured: false,
          codexCli: { loggedIn: false, method: null },
          openAiAccountSession: {
            authenticated: false,
            pending: false,
            expiresAt: null,
          },
          mcp: {
            connected: false,
            persistent: false,
            toolCount: 0,
            missingTools: [],
            checkedAt: null,
          },
          setup: {
            chatGptSignInCommand: "codex login",
            providerEnvValue: "openai-codex",
          },
        }}
        onStartChatGptSignIn={onStartChatGptSignIn}
      />,
    );

    await user.click(screen.getByTestId("ai-auth-sign-in-button"));

    expect(onStartChatGptSignIn).toHaveBeenCalledTimes(1);
  });

  it("renders the OpenAI account device-auth link and one-time code", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        unavailable
        authActionMessage="Open the OpenAI sign-in link and enter the one-time code shown in the app."
        authActionDeviceAuth={{
          verificationUri: "https://auth.openai.com/codex/device",
          userCode: "ABCD-12345",
          expiresAt: Date.now() + 15 * 60_000,
        }}
      />,
    );

    const deviceAuth = screen.getByTestId("ai-auth-device-code");
    expect(deviceAuth).toHaveTextContent("OpenAI account sign-in");
    expect(deviceAuth).toHaveTextContent("ABCD-12345");
    expect(
      within(deviceAuth).getByRole("link", {
        name: "https://auth.openai.com/codex/device",
      }),
    ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  });

  it("requires OpenAI account auth when Codex is logged in with an API key", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        unavailable
        authStatus={{
          providerPreference: "codex-cli",
          activeProvider: "none",
          canUseAssistant: false,
          openAiApiKeyConfigured: false,
          codexCli: { loggedIn: true, method: "api-key" },
          openAiAccountSession: {
            authenticated: false,
            pending: false,
            expiresAt: null,
          },
          mcp: {
            connected: false,
            persistent: false,
            toolCount: 0,
            missingTools: [],
            checkedAt: null,
          },
          setup: {
            chatGptSignInCommand: "codex login",
            providerEnvValue: "openai-codex",
          },
        }}
        onStartChatGptSignIn={vi.fn()}
      />,
    );

    expect(screen.getByTestId("ai-auth-status")).toHaveTextContent(
      "OpenAI account sign-in required",
    );
    expect(screen.getByTestId("ai-auth-sign-in-button")).toHaveTextContent(
      "Sign in with OpenAI",
    );
  });

  it("shows MCP tool bridge disconnection without offering another Codex sign-in", () => {
    const onStartChatGptSignIn = vi.fn();
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        onSendMessage={vi.fn()}
        unavailable
        authStatus={{
          providerPreference: "codex-cli",
          activeProvider: "none",
          canUseAssistant: false,
          openAiApiKeyConfigured: false,
          codexCli: { loggedIn: true, method: "chatgpt" },
          openAiAccountSession: {
            authenticated: true,
            pending: false,
            expiresAt: 86_400_000,
          },
          mcp: {
            connected: false,
            persistent: true,
            toolCount: 0,
            missingTools: ["getScaffoldPlan"],
            checkedAt: 1_000,
            error: "MCP bridge failed.",
          },
          setup: {
            chatGptSignInCommand: "codex login",
            providerEnvValue: "openai-codex",
          },
        }}
        onStartChatGptSignIn={onStartChatGptSignIn}
      />,
    );

    expect(screen.getByTestId("ai-auth-status")).toHaveTextContent(
      "MCP tools disconnected",
    );
    expect(screen.getByTestId("ai-unavailable-message")).toHaveTextContent(
      "Stillas MCP tool bridge is not connected",
    );
    expect(screen.queryByTestId("ai-auth-sign-in-button")).not.toBeInTheDocument();
  });
});

describe("AiChatPanel engine-computed tool-result rendering (Req 13.1)", () => {
  const NUMBER_OF_BAYS = 7;
  const NUMBER_OF_LEVELS = 3;
  const TOTAL_SCAFFOLD_LENGTH_METERS = 48.6;
  const DECIMAL_PLACES = 2;

  /** A deterministic calculateScaffoldMaterials result, as echoed by the route. */
  const calculationResult: AiToolResult = {
    tool: "calculateScaffoldMaterials",
    ok: true,
    data: {
      totalScaffoldLengthMeters: TOTAL_SCAFFOLD_LENGTH_METERS,
      numberOfBays: NUMBER_OF_BAYS,
      numberOfLevels: NUMBER_OF_LEVELS,
      materialList: [
        { id: "standard", itemName: "Standard", quantity: 24, unit: "pcs" },
        { id: "ledger", itemName: "Ledger", quantity: 56, unit: "pcs", notes: "3 m" },
        { id: "base-plate", itemName: "Base plate", quantity: 8, unit: "pcs" },
      ],
      warnings: [],
    },
  };

  function renderWithResult() {
    return render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        toolResults={[calculationResult]}
        onSendMessage={vi.fn()}
        decimalPlaces={DECIMAL_PLACES}
      />,
    );
  }

  it("renders a calculation card for the calculateScaffoldMaterials tool result", () => {
    renderWithResult();

    expect(screen.getByTestId("ai-tool-results")).toBeInTheDocument();
    expect(
      screen.getByTestId("ai-calculation-card-calculateScaffoldMaterials"),
    ).toBeInTheDocument();
  });

  it("shows the engine-computed bays and levels verbatim", () => {
    renderWithResult();

    expect(screen.getByTestId("ai-quantity-bays")).toHaveTextContent(
      String(NUMBER_OF_BAYS),
    );
    expect(screen.getByTestId("ai-quantity-levels")).toHaveTextContent(
      String(NUMBER_OF_LEVELS),
    );
  });

  it("shows the engine-computed scaffold length formatted to the configured decimals", () => {
    renderWithResult();

    const expected = `${formatMeasurement(
      TOTAL_SCAFFOLD_LENGTH_METERS,
      DECIMAL_PLACES,
    )} m`;
    expect(screen.getByTestId("ai-quantity-scaffoldLength")).toHaveTextContent(
      expected,
    );
  });

  it("renders every engine-computed material line with its quantity and unit", () => {
    renderWithResult();

    const card = screen.getByTestId(
      "ai-calculation-card-calculateScaffoldMaterials",
    );

    const standard = within(card).getByTestId("ai-material-standard");
    expect(standard).toHaveTextContent("Standard");
    expect(standard).toHaveTextContent("24 pcs");

    const ledger = within(card).getByTestId("ai-material-ledger");
    expect(ledger).toHaveTextContent("Ledger");
    expect(ledger).toHaveTextContent("56 pcs");
    // Notes returned by the engine are surfaced alongside the line.
    expect(ledger).toHaveTextContent("3 m");

    const basePlate = within(card).getByTestId("ai-material-base-plate");
    expect(basePlate).toHaveTextContent("Base plate");
    expect(basePlate).toHaveTextContent("8 pcs");
  });

  it("shows footprint measurements returned by the perimeter-from-location tool", () => {
    render(
      <AiChatPanel
        messages={SAMPLE_MESSAGES}
        toolResults={[
          {
            tool: "setBuildingPerimeterFromLocation",
            ok: true,
            data: {
              candidateCount: 3,
              selectedIndex: 0,
              selectedCandidate: {
                perimeterMeters: 54.13,
                areaSquareMeters: 170.29,
              },
              scaffoldLengthMeters: 54.13,
            },
          },
        ]}
        onSendMessage={vi.fn()}
        decimalPlaces={DECIMAL_PLACES}
      />,
    );

    expect(
      screen.getByTestId("ai-calculation-card-setBuildingPerimeterFromLocation"),
    ).toHaveTextContent("Selected house perimeter");
    expect(screen.getByTestId("ai-quantity-perimeter")).toHaveTextContent(
      "54.13 m",
    );
    expect(screen.getByTestId("ai-quantity-area")).toHaveTextContent(
      "170.29 m2",
    );
    expect(screen.getByTestId("ai-quantity-candidateCount")).toHaveTextContent(
      "3",
    );
  });
});

describe("AiChatPanel assistant message formatting", () => {
  it("renders assistant markdown lists and bold text without exposing raw markers", () => {
    render(
      <AiChatPanel
        messages={[
          {
            id: "m-md",
            role: "assistant",
            content:
              "I found options:\n\n1. **Main perimeter:**\n- Perimeter: 54.13 m\n- Area: 170.29 m2",
            timestamp: 1,
          },
        ]}
        onSendMessage={vi.fn()}
      />,
    );

    const message = screen.getByTestId("ai-message-m-md");
    expect(within(message).getAllByRole("list")).toHaveLength(2);
    expect(within(message).getByText("Main perimeter:")).toBeInTheDocument();
    expect(message).toHaveTextContent("Perimeter: 54.13 m");
    expect(message).not.toHaveTextContent("**Main perimeter:**");
  });
});
