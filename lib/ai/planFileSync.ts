import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { ScaffoldPlan } from '@/lib/types';

export async function writePlanFile(
  filePath: string,
  plan: ScaffoldPlan,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(plan, null, 2), 'utf8');
}

export async function readPlanFile(filePath: string): Promise<ScaffoldPlan> {
  const raw = await readFile(filePath, 'utf8');
  return parseScaffoldPlan(JSON.parse(raw) as unknown);
}

export function getCadExportDir(sessionId: string): string {
  return join(process.cwd(), '.stillas-cad', sessionId);
}
