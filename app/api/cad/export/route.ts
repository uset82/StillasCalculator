import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getCadExportDir } from '@/lib/ai/planFileSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const session = url.searchParams.get('session');
  const format = url.searchParams.get('format');

  if (!session || (format !== 'scad' && format !== 'stl' && format !== 'dxf')) {
    return NextResponse.json({ error: 'Invalid session or format.' }, { status: 400 });
  }

  const safeSession = session.replace(/[^a-zA-Z0-9-]/g, '');
  const filePath = join(getCadExportDir(safeSession), `scaffold-${safeSession}.${format}`);

  try {
    const content = await readFile(filePath);
    const contentType =
      format === 'scad'
        ? 'text/plain'
        : format === 'stl'
          ? 'model/stl'
          : 'application/dxf';
    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="scaffold.${format}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Export file not found.' }, { status: 404 });
  }
}
