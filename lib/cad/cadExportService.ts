import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { buildScaffoldOpenScad } from '@/lib/cad/scaffoldOpenScadTemplate';
import type { ScaffoldPlan } from '@/lib/types';

export type CadExportFormat = 'scad' | 'stl' | 'dxf';

export interface CadExportResult {
  ok: true;
  format: CadExportFormat;
  filePath: string;
  downloadUrl: string;
}

export interface CadExportError {
  ok: false;
  error: string;
}

function runOpenScad(
  scadPath: string,
  outputPath: string,
  format: 'stl' | 'dxf',
): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'openscad',
      ['-o', outputPath, `--export-format=${format}`, scadPath],
      { windowsHide: true },
    );
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', () => {
      resolve({
        ok: false,
        stderr: 'OpenSCAD CLI is not installed on the server.',
      });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

export async function exportCadFormat(
  plan: ScaffoldPlan,
  format: CadExportFormat,
  exportDir: string,
  sessionId: string,
): Promise<CadExportResult | CadExportError> {
  const source = buildScaffoldOpenScad(plan);
  if (!source) {
    return {
      ok: false,
      error:
        'Cannot generate CAD until scaffold dimensions and calculation are complete. Run calculateScaffoldMaterials first.',
    };
  }

  await mkdir(exportDir, { recursive: true });
  const scadPath = join(exportDir, `scaffold-${sessionId}.scad`);
  await writeFile(scadPath, source, 'utf8');

  if (format === 'scad') {
    const downloadUrl = `/api/cad/export?session=${encodeURIComponent(sessionId)}&format=scad`;
    return { ok: true, format: 'scad', filePath: scadPath, downloadUrl };
  }

  const outPath = join(exportDir, `scaffold-${sessionId}.${format}`);
  const result = await runOpenScad(scadPath, outPath, format);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.stderr ||
        `OpenSCAD could not produce .${format}. Install OpenSCAD CLI or export .scad and compile in the browser preview.`,
    };
  }

  const downloadUrl = `/api/cad/export?session=${encodeURIComponent(sessionId)}&format=${format}`;
  return { ok: true, format, filePath: outPath, downloadUrl };
}
