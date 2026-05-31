export {
  AI_TOOLS,
  createToolDispatch,
  executeTool,
  getToolDefinitions,
  type PlanToolContext,
  type ToolDefinition,
  type ToolExecutorFn,
  type ToolName,
  type ToolResult,
} from '@/lib/ai/toolExecutor';

export { buildReportSummary, type ReportSummary } from '@/lib/ai/reportSummary';

/** @deprecated Use PlanToolContext */
export type { PlanToolContext as ToolContext } from '@/lib/ai/toolExecutor';
