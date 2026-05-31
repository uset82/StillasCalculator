// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { writePlanFile } from '@/lib/ai/planFileSync';
import { getToolDefinitions } from '@/lib/ai/toolExecutor';
import {
  buildStillasMcpServerConfig,
  checkStillasMcpBridgeForPlan,
  closePersistentMcpToolBridge,
  ensurePersistentMcpToolBridge,
} from './mcpBridge';

afterEach(async () => {
  await closePersistentMcpToolBridge();
});

async function withTempPlan<T>(
  run: (planFile: string, tempDir: string) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'stillas-mcp-test-'));
  const planFile = join(tempDir, 'scaffold-plan.json');
  await writePlanFile(planFile, createScaffoldPlan());
  try {
    return await run(planFile, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe('Stillas MCP bridge availability', () => {
  it('builds the Codex MCP server config from project-local runtime paths', async () => {
    await withTempPlan(async (planFile) => {
      const config = buildStillasMcpServerConfig(planFile, 'config-test');

      expect(config.command).toBe(process.execPath);
      expect(config.args[0]).toMatch(/node_modules[\\/]+tsx[\\/]+dist[\\/]+cli\.mjs$/);
      expect(config.args[1]).toMatch(/scripts[\\/]+stillas-mcp-server\.ts$/);
      expect(config.env.STILLAS_PLAN_FILE).toBe(planFile);
      expect(config.env.STILLAS_SESSION_ID).toBe('config-test');
      expect(config.env.TSX_TSCONFIG_PATH).toMatch(/tsconfig\.json$/);
    });
  });

  it('connects to the MCP server and verifies every app tool is listed', async () => {
    await withTempPlan(async (planFile) => {
      const status = await checkStillasMcpBridgeForPlan(planFile, 'probe-test');

      expect(status.connected).toBe(true);
      expect(status.persistent).toBe(false);
      expect(status.missingTools).toEqual([]);
      expect(status.toolCount).toBe(getToolDefinitions().length);
    });
  });

  it('keeps a persistent MCP health bridge warm for auth/status checks', async () => {
    const status = await ensurePersistentMcpToolBridge();

    expect(status.connected).toBe(true);
    expect(status.persistent).toBe(true);
    expect(status.missingTools).toEqual([]);
    expect(status.toolCount).toBe(getToolDefinitions().length);
  });
});
