import { findCatalogModel, type Catalog, type StoredRun } from "./paseo-catalog";

export type ExecuteTask = {
  title: string;
  body: string;
  images: Array<{ id: string }>;
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
};

export type ExecuteRequest =
  | {
      ok: true;
      prompt: string;
      config: {
        provider: string;
        thinkingOptionId?: string;
        modeId?: string;
      };
      imageIds: string[];
    }
  | { ok: false; error: string };

export function prepareExecuteRequest(input: { task: ExecuteTask; catalog: Catalog }): ExecuteRequest {
  const { task, catalog } = input;
  if (!task.provider || !task.model) return { ok: false, error: "请先选择模型" };
  const stored: StoredRun = {
    provider: task.provider,
    model: task.model,
    thinkingOptionId: task.thinkingOptionId,
    modeId: task.modeId,
  };
  const model = findCatalogModel(catalog.models, stored);
  if (!model) return { ok: false, error: "当前模型已不可用，请重新选择" };
  const pack = catalog.packs.find((entry) => entry.provider === model.provider);
  const thinking =
    (stored.thinkingOptionId && model.thinkingOptions.some((option) => option.id === stored.thinkingOptionId)
      ? stored.thinkingOptionId
      : null) ??
    model.defaultThinkingOptionId ??
    model.thinkingOptions.find((option) => option.isDefault)?.id ??
    model.thinkingOptions[0]?.id ??
    undefined;
  const mode =
    (stored.modeId && pack?.modes.some((item) => item.id === stored.modeId) ? stored.modeId : null) ??
    pack?.defaultModeId ??
    pack?.modes.find((item) => item.id === "full")?.id ??
    pack?.modes[0]?.id ??
    undefined;
  const body = task.body.trim();
  const title = task.title.trim();
  const imageIds = task.images.map((image) => image.id);
  const prompt = body || title || (imageIds.length > 0 ? "见图" : "");
  if (!prompt) return { ok: false, error: "任务没有可执行的正文或图片" };
  return {
    ok: true,
    prompt,
    config: {
      provider: `${model.provider}/${model.id}`,
      ...(thinking ? { thinkingOptionId: thinking } : {}),
      ...(mode ? { modeId: mode } : {}),
    },
    imageIds,
  };
}

export function applyTaskRun<
  T extends {
    lastAgentId: string | null;
    runs: Array<{ id: string; agentId: string; createdAt: string; promptPreview: string }>;
    updatedAt: string;
  },
>(
  task: T,
  input: { agentId: string; createdAt: string; promptPreview: string },
): T {
  return {
    ...task,
    lastAgentId: input.agentId,
    updatedAt: input.createdAt,
    runs: [
      {
        id: crypto.randomUUID(),
        agentId: input.agentId,
        createdAt: input.createdAt,
        promptPreview: input.promptPreview,
      },
      ...task.runs,
    ],
  };
}

export function previewPrompt(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ");
  return text.length <= 80 ? text : `${text.slice(0, 80)}…`;
}
