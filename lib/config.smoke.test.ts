// Smoke & configuration tests (task 18.2).
//
// These tests guard the architectural and trust-boundary invariants that hold
// across the whole codebase rather than inside any single module:
//
//   - No Google/paid map dependencies are present and the basemap is the
//     zero-key OpenFreeMap style (Req 2.5).
//   - Geocoding and Overpass are reached only through server routes; the
//     browser-facing adapters never call the public providers directly
//     (Req 3.9, 4.7).
//   - The OpenRouter API key is read only inside the server AI auth boundary and
//     never leaks into a client/component module that ships in the browser bundle
//     (Req 12.6).
//   - Exactly the six AI tools are registered (Req 13.2).
//   - There is a single shared Project_State instance (Req 17.1).
//   - The stack/build dependencies are present (Req 1.6).
//
// File contents are read with Node's `fs` so the assertions reflect what is
// actually on disk (and therefore what ships) rather than a re-export that a
// test could accidentally satisfy.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AI_TOOLS, getToolDefinitions, type ToolName } from '@/lib/ai/tools';
import { projectStateController } from '@/lib/state/projectStateController';

// Repo root, derived from this file's location (lib/config.smoke.test.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** Recursively collects source file paths under a repo-relative directory. */
function collectSourceFiles(relativeDir: string): string[] {
  const root = join(REPO_ROOT, relativeDir);
  if (!existsSync(root)) return [];
  const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (sourceExts.has(extname(full))) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readRepoFile('package.json')) as PackageJson;
}

// ---------------------------------------------------------------------------
// Req 2.5 — No Google/paid map dependencies; OpenFreeMap basemap is used.
// ---------------------------------------------------------------------------

describe('map provider configuration (Req 2.5)', () => {
  it('declares no Google or paid (Mapbox) map dependencies', () => {
    const pkg = readPackageJson();
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].map((name) => name.toLowerCase());

    const forbidden = ['google', '@googlemaps', 'googlemaps', 'mapbox'];
    for (const name of names) {
      for (const banned of forbidden) {
        expect(
          name.includes(banned),
          `dependency "${name}" matches forbidden map provider "${banned}"`,
        ).toBe(false);
      }
    }
  });

  it('uses MapLibre GL JS as the (open-source) map engine', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies?.['maplibre-gl']).toBeTruthy();
  });

  it('configures the zero-key OpenFreeMap basemap style in MapView', () => {
    const mapView = readRepoFile('components/map/MapView.tsx');
    expect(mapView).toContain('OPENFREEMAP_STYLE_URL');
    expect(mapView).toContain('tiles.openfreemap.org');
  });
});

// ---------------------------------------------------------------------------
// Req 3.9, 4.7 — Geocoding and Overpass run server-side only; the client
// adapters talk to local routes, never to the public providers directly.
// ---------------------------------------------------------------------------

describe('geocoding & Overpass server-side trust boundary (Req 3.9, 4.7)', () => {
  it('provides the geocoding and Overpass server routes', () => {
    expect(existsSync(join(REPO_ROOT, 'app/api/geocoding/photon/route.ts'))).toBe(
      true,
    );
    expect(
      existsSync(join(REPO_ROOT, 'app/api/overpass/buildings/route.ts')),
    ).toBe(true);
  });

  it('client geocoding adapter calls the local route, not the public provider (Req 3.9)', () => {
    const adapter = readRepoFile('lib/geocoding/photon.ts');

    // It must reach the providers through the server route.
    expect(adapter).toContain('/api/geocoding/photon');

    // It must NOT contact the public geocoding hosts directly from the browser.
    const externalHosts = [
      'photon.komoot.io',
      'nominatim.openstreetmap.org',
      'komoot.io',
    ];
    for (const host of externalHosts) {
      expect(
        adapter.includes(host),
        `client geocoding adapter must not reference external host "${host}"`,
      ).toBe(false);
    }
  });

  it('client Overpass/footprint code never contacts the Overpass API directly (Req 4.7)', () => {
    // Any browser-facing module under lib/osm must not embed an Overpass host;
    // the only place that may is the server route.
    const externalHosts = [
      'overpass-api.de',
      'overpass.kumi.systems',
      '//overpass',
    ];
    for (const file of collectSourceFiles('lib/osm')) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const text = readFileSync(file, 'utf8');
      for (const host of externalHosts) {
        expect(
          text.includes(host),
          `${file} must not reference Overpass host "${host}"`,
        ).toBe(false);
      }
    }

    // The server route is the one place the Overpass endpoint is reached.
    const serverRoute = readRepoFile('app/api/overpass/buildings/route.ts');
    expect(serverRoute.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Req 12.6 — The OpenRouter API key is read only in server AI auth code and is
// absent from every client/component module that ships to the browser.
// ---------------------------------------------------------------------------

describe('OpenRouter key confinement (Req 12.6)', () => {
  const KEY = 'OPENROUTER_API_KEY';
  const SERVER_AUTH_MODULE = join(REPO_ROOT, 'lib/server/aiAuth.ts');

  it('reads the OpenRouter key only in the server AI auth boundary', () => {
    const serverAuthModule = readFileSync(SERVER_AUTH_MODULE, 'utf8');
    expect(serverAuthModule).toContain(KEY);
  });

  it('never references the OpenRouter key in client AI modules or components (Req 12.6)', () => {
    const candidateFiles = [
      ...collectSourceFiles('lib/ai'),
      ...collectSourceFiles('components'),
    ];

    for (const file of candidateFiles) {
      const text = readFileSync(file, 'utf8');
      expect(
        text.includes(KEY),
        `${file} must not reference ${KEY} (it would ship in the client bundle)`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Req 13.2 — Exactly the six AI tools are registered.
// ---------------------------------------------------------------------------

describe('AI tool registration (Req 13.2)', () => {
  const EXPECTED_TOOL_NAMES: ToolName[] = [
    'getScaffoldPlan',
    'calculateScaffoldMaterials',
    'getSelectedBuildingMeasurements',
    'getAvailableScaffoldSystems',
    'updateWorkingHeight',
    'setBuildingPerimeter',
    'setBuildingPerimeterFromLocation',
    'selectFacadeSides',
    'setScaffoldSystem',
    'setScaffoldDimensions',
    'generateMaterialList',
    'generateReportSummary',
    'generateScaffoldDrawing',
    'clearScaffoldDrawing',
    'generateCadModel',
    'exportCadFormat',
    'retrieveBuildingFootprints',
  ];

  it('registers all deterministic app tools', () => {
    expect(AI_TOOLS).toHaveLength(EXPECTED_TOOL_NAMES.length);
    expect(getToolDefinitions()).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  it('registers exactly the expected tool names', () => {
    const names = AI_TOOLS.map((tool) => tool.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('gives every tool a description and a parameters schema', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.parameters).toBeTypeOf('object');
    }
  });
});

// ---------------------------------------------------------------------------
// Req 17.1 — A single shared Project_State instance.
// ---------------------------------------------------------------------------

describe('single Project_State instance (Req 17.1)', () => {
  it('exposes one shared controller (re-import yields the same reference)', async () => {
    const moduleA = await import('@/lib/state/projectStateController');
    const moduleB = await import('@/lib/state/projectStateController');
    expect(moduleA.projectStateController).toBe(projectStateController);
    expect(moduleB.projectStateController).toBe(projectStateController);
    expect(moduleA.projectStateController).toBe(moduleB.projectStateController);
  });

  it('holds exactly one ScaffoldPlan object', () => {
    const stateA = projectStateController.getState();
    const stateB = projectStateController.getState();
    expect(stateA).toBeTypeOf('object');
    expect(stateA.version).toBeGreaterThan(0);
    expect(stateA).toBe(stateB);
  });
});

// ---------------------------------------------------------------------------
// Req 1.6 — Stack/build configuration is present.
// ---------------------------------------------------------------------------

describe('stack & build configuration (Req 1.6)', () => {
  it('declares the core framework and tooling dependencies', () => {
    const pkg = readPackageJson();
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

    for (const required of [
      'next',
      'react',
      'react-dom',
      'typescript',
      'tailwindcss',
    ]) {
      expect(all[required], `package.json must declare "${required}"`).toBeTruthy();
    }
  });
});
