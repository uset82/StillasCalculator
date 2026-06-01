import type {
  ChatMessage,
  ScaffoldCalculationInput,
  ScaffoldCalculationOutput,
  ScaffoldPlan,
  ScaffoldSystemId,
} from '@/lib/types';
import type { ProjectStateController } from '@/lib/state/projectStateController';
import {
  pickFootprintCandidate,
  retrieveBuildingFootprints,
} from '@/lib/ai/buildingFootprints';
import { calculateScaffoldMaterials } from '@/lib/scaffold/scaffoldCalculator';
import { getScaffoldSystem } from '@/lib/scaffold/scaffoldSystems';

const DEFAULT_SCAFFOLD_SYSTEM_ID: ScaffoldSystemId = 'generic-frame';
const DEFAULT_WORKING_HEIGHT_METERS = 6;

export interface DeterministicAiToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface DeterministicScaffoldEstimate {
  reply: string;
  toolResults: DeterministicAiToolResult[];
  scaffoldPlan: ScaffoldPlan;
}

function normalizeForIntent(content: string): string {
  return content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isScaffoldQuantityPrompt(content: string): boolean {
  const normalized = normalizeForIntent(content);
  const asksForQuantity =
    /\b(cuantos|cuanto|necesito|need|how many|estimate|calcula|calculate)\b/.test(
      normalized,
    );
  const mentionsScaffold =
    /\b(andamio|andamios|scaffold|scaffolding|material|materiales|bays?)\b/.test(
      normalized,
    );
  return asksForQuantity && mentionsScaffold;
}

function isSpanishPrompt(content: string): boolean {
  return /\b(cuantos|cuanto|necesito|casa|andamios|para)\b/.test(
    normalizeForIntent(content),
  );
}

export function extractAddressForScaffoldEstimate(content: string): string | null {
  const trimmed = content.trim().replace(/[?¿!]+$/g, '').trim();
  const patterns = [
    /\b(?:casa|house|address|direccion|dirección)\s+(.+)$/i,
    /\b(?:para|for|at|en)\s+(?:la\s+)?(?:casa\s+)?(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && /[a-zA-Z]/.test(candidate) && /\d/.test(candidate)) {
      return candidate;
    }
  }

  if (/[a-zA-Z]/.test(trimmed) && /\d/.test(trimmed)) {
    return trimmed
      .replace(/^.*?\b(?:andamios?|scaffolding|scaffold|materials?|materiales)\b/i, '')
      .replace(/^\s*(?:necesito|need|for|para|at|en|la|casa)\s+/i, '')
      .trim() || null;
  }

  return null;
}

function formatMeters(value: number): string {
  return value.toFixed(2);
}

function buildReply(
  userContent: string,
  calculation: ScaffoldCalculationOutput,
  plan: ScaffoldPlan,
  address: string | null,
): string {
  const system = plan.scaffoldSystemId
    ? getScaffoldSystem(plan.scaffoldSystemId)
    : undefined;
  const perimeter = plan.scaffoldLengthMeters ?? calculation.totalScaffoldLengthMeters;
  const height = plan.workingHeightMeters ?? DEFAULT_WORKING_HEIGHT_METERS;
  const bay = plan.bayLengthMeters ?? system?.defaultBayLengthMeters;
  const systemName = system?.displayName ?? plan.scaffoldSystemId ?? 'selected system';
  const place = address ?? plan.address?.label ?? 'the selected house';

  if (isSpanishPrompt(userContent)) {
    return [
      `Para ${place}, la estimación usa ${formatMeters(perimeter)} m de perímetro de andamio.`,
      `Necesitas ${calculation.numberOfBays} tramos/bahías y ${calculation.numberOfLevels} niveles.`,
      `Supuestos: sistema ${systemName}, bahía ${bay ? formatMeters(bay) : 'n/a'} m y altura de trabajo ${formatMeters(height)} m. Ajusta altura, sistema o fachadas si no coincide con la obra real.`,
    ].join('\n');
  }

  return [
    `For ${place}, the estimate uses ${formatMeters(perimeter)} m of scaffold run.`,
    `You need ${calculation.numberOfBays} bays and ${calculation.numberOfLevels} levels.`,
    `Assumptions: ${systemName}, ${bay ? formatMeters(bay) : 'n/a'} m bay length, and ${formatMeters(height)} m working height. Adjust height, system, or selected facades if the real job differs.`,
  ].join('\n');
}

function buildCalculationInput(plan: ScaffoldPlan): ScaffoldCalculationInput | null {
  if (
    plan.scaffoldLengthMeters === null ||
    plan.workingHeightMeters === null ||
    plan.bayLengthMeters === null ||
    plan.liftHeightMeters === null ||
    plan.scaffoldWidthMeters === null ||
    plan.scaffoldSystemId === null
  ) {
    return null;
  }

  return {
    scaffoldLengthMeters: plan.scaffoldLengthMeters,
    workingHeightMeters: plan.workingHeightMeters,
    bayLengthMeters: plan.bayLengthMeters,
    liftHeightMeters: plan.liftHeightMeters,
    scaffoldWidthMeters: plan.scaffoldWidthMeters,
    scaffoldSystemId: plan.scaffoldSystemId,
    wasteFactorPercent: plan.wasteFactorPercent,
  };
}

export async function tryBuildDeterministicScaffoldEstimate(
  latestUser: ChatMessage | undefined,
  projectState: ScaffoldPlan | undefined,
  controller: ProjectStateController,
): Promise<DeterministicScaffoldEstimate | null> {
  if (!latestUser || !isScaffoldQuantityPrompt(latestUser.content)) {
    return null;
  }

  if (projectState) {
    controller.applyScaffoldPlan(projectState);
  }

  const toolResults: DeterministicAiToolResult[] = [];
  let plan = controller.getScaffoldPlan();
  let address = plan.address?.label ?? null;

  if (!plan.measurements?.valid || plan.scaffoldLengthMeters === null) {
    address = extractAddressForScaffoldEstimate(latestUser.content);
    if (!address) {
      return null;
    }

    const footprints = await retrieveBuildingFootprints({ address });
    if (!footprints.ok) {
      const error =
        footprints.error === 'address-not-found'
          ? 'The address could not be located. Try a more specific address or draw the perimeter manually.'
          : 'The building footprint service did not respond. Try again or draw the perimeter manually.';
      toolResults.push({ tool: 'setBuildingPerimeterFromLocation', ok: false, error });
      return {
        reply: isSpanishPrompt(latestUser.content)
          ? `${error} No cambié los datos del proyecto.`
          : `${error} I did not change the project data.`,
        toolResults,
        scaffoldPlan: controller.getScaffoldPlan(),
      };
    }

    const selected = pickFootprintCandidate(
      footprints.data.candidates,
      footprints.data.coordinate,
      'nearest',
    );
    if (!selected) {
      const error =
        'No usable building footprint was found near that address. Draw the perimeter manually or provide a more specific address.';
      toolResults.push({ tool: 'setBuildingPerimeterFromLocation', ok: false, error });
      return {
        reply: isSpanishPrompt(latestUser.content)
          ? `${error} No cambié los datos del proyecto.`
          : `${error} I did not change the project data.`,
        toolResults,
        scaffoldPlan: controller.getScaffoldPlan(),
      };
    }

    controller.setAddress({
      label: address,
      lat: footprints.data.coordinate.lat,
      lon: footprints.data.coordinate.lon,
    });
    const perimeterUpdate = controller.setPerimeter(selected.polygon);
    if (!perimeterUpdate.ok) {
      const error =
        perimeterUpdate.error?.message ?? 'The selected footprint could not be used.';
      toolResults.push({ tool: 'setBuildingPerimeterFromLocation', ok: false, error });
      return {
        reply: error,
        toolResults,
        scaffoldPlan: controller.getScaffoldPlan(),
      };
    }

    plan = controller.getScaffoldPlan();
    toolResults.push({
      tool: 'setBuildingPerimeterFromLocation',
      ok: true,
      data: {
        coordinate: footprints.data.coordinate,
        candidateCount: footprints.data.candidates.length,
        selectedIndex: selected.index,
        selectionStrategy: 'nearest',
        selectedCandidate: {
          index: selected.index,
          perimeterMeters: selected.perimeterMeters,
          areaSquareMeters: selected.areaSquareMeters,
        },
        measurements: plan.measurements,
        scaffoldLengthMeters: plan.scaffoldLengthMeters,
      },
    });
  }

  plan = controller.getScaffoldPlan();
  if (!plan.scaffoldSystemId) {
    controller.setScaffoldSystem(DEFAULT_SCAFFOLD_SYSTEM_ID);
  }
  if (controller.getScaffoldPlan().workingHeightMeters === null) {
    controller.setWorkingHeight(DEFAULT_WORKING_HEIGHT_METERS);
  }

  const input = buildCalculationInput(controller.getScaffoldPlan());
  if (!input) {
    return null;
  }

  const calculation = calculateScaffoldMaterials(input);
  if (!calculation.ok) {
    const error = calculation.error.message;
    toolResults.push({ tool: 'calculateScaffoldMaterials', ok: false, error });
    return {
      reply: error,
      toolResults,
      scaffoldPlan: controller.getScaffoldPlan(),
    };
  }

  controller.applyCalculation(calculation.output);
  const finalPlan = controller.getScaffoldPlan();
  toolResults.push({
    tool: 'calculateScaffoldMaterials',
    ok: true,
    data: calculation.output,
  });

  return {
    reply: buildReply(latestUser.content, calculation.output, finalPlan, address),
    toolResults,
    scaffoldPlan: finalPlan,
  };
}
