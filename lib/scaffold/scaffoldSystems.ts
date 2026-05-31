// Scaffold_Library: the exactly-five selectable scaffold systems (Req 7.1).
//
// The system definitions live in `data/scaffold-systems.json` as plain data so
// they can be reviewed and extended without touching code. This module loads
// that data, asserts the `ScaffoldSystem` shape from `lib/types.ts`, and
// exposes a typed, immutable list plus small helper getters used by the
// scaffold selector UI, the state controller (which loads a system's defaults
// on selection, Req 7.2), and the AI `getAvailableScaffoldSystems` tool.
//
// Placeholder systems (HAKI, Layher, Instant/Alufase) carry `isPlaceholder`
// so the UI can show the non-certified notice (Req 7.4); the Custom Dimensions
// system carries `isCustom` so its dimensions are user-editable (Req 7.5).

import type { ScaffoldSystem, ScaffoldSystemId } from '@/lib/types';
import scaffoldSystemsData from '@/data/scaffold-systems.json';

/**
 * The five scaffold systems, in display order (Req 7.1). The JSON data is
 * asserted to the `ScaffoldSystem[]` shape and frozen so callers cannot mutate
 * the shared library at runtime.
 */
export const SCAFFOLD_SYSTEMS: readonly ScaffoldSystem[] = Object.freeze(
  (scaffoldSystemsData as ScaffoldSystem[]).map((system) =>
    Object.freeze({ ...system })
  )
);

/**
 * Returns every scaffold system in the library (Req 7.1). Used by the system
 * selector UI and the AI `getAvailableScaffoldSystems` tool.
 */
export function getAllScaffoldSystems(): readonly ScaffoldSystem[] {
  return SCAFFOLD_SYSTEMS;
}

/**
 * Returns the scaffold system with the given id, or `undefined` when no system
 * matches. Used when a user selects a system so its default bay/width/lift can
 * be loaded into `Project_State` (Req 7.2).
 */
export function getScaffoldSystem(
  id: ScaffoldSystemId
): ScaffoldSystem | undefined {
  return SCAFFOLD_SYSTEMS.find((system) => system.id === id);
}
