import assert from "node:assert/strict";
import test from "node:test";
import { buildRunnableCatalog } from "./paseo-catalog";
import { applyTaskRun, prepareExecuteRequest } from "./execute-run";

const grok = {
  id: "xai-oauth/grok-4.6",
  label: "Grok 4.6",
  thinkingOptions: [
    { id: "low", label: "Low" },
    { id: "high", label: "High", isDefault: true },
  ],
  defaultThinkingOptionId: "high",
};

const catalog = buildRunnableCatalog({
  entries: [
    {
      provider: "omp",
      label: "Oh My Pi",
      status: "ready",
      defaultModeId: "full",
      modes: [
        { id: "full", label: "Full access" },
        { id: "ask", label: "Ask" },
      ],
      models: [grok],
    },
  ],
});

const task = {
  id: "task-1",
  title: "修登录",
  body: "先复现再改",
  images: [] as Array<{ id: string }>,
  provider: "omp",
  model: "xai-oauth/grok-4.6",
  thinkingOptionId: "high",
  modeId: "full",
  lastAgentId: null as string | null,
  runs: [] as Array<{ id: string; agentId: string; createdAt: string; promptPreview: string }>,
  updatedAt: "2026-08-24T00:00:00.000Z",
};

test("builds an agent create payload from a ready stored model", () => {
  const result = prepareExecuteRequest({ task, catalog });
  assert.deepEqual(result, {
    ok: true,
    prompt: "先复现再改",
    config: {
      provider: "omp/xai-oauth/grok-4.6",
      thinkingOptionId: "high",
      modeId: "full",
    },
    imageIds: [],
  });
});

test("uses the title when the body is empty", () => {
  const result = prepareExecuteRequest({ task: { ...task, body: "  " }, catalog });
  assert.equal(result.ok && result.prompt, "修登录");
});

test("rejects a stored model that is no longer ready", () => {
  const result = prepareExecuteRequest({
    task: { ...task, provider: "claude", model: "claude-sonnet-4" },
    catalog,
  });
  assert.deepEqual(result, { ok: false, error: "当前模型已不可用，请重新选择" });
});

test("rejects a task with no stored model", () => {
  const result = prepareExecuteRequest({
    task: { ...task, provider: null, model: null },
    catalog,
  });
  assert.deepEqual(result, { ok: false, error: "请先选择模型" });
});

test("rejects a task with no prompt and no images", () => {
  const result = prepareExecuteRequest({
    task: { ...task, title: "  ", body: "" },
    catalog,
  });
  assert.deepEqual(result, { ok: false, error: "任务没有可执行的正文或图片" });
});

test("allows an image-only task and keeps the image ids", () => {
  const result = prepareExecuteRequest({
    task: { ...task, title: "", body: "", images: [{ id: "img-1" }, { id: "img-2" }] },
    catalog,
  });
  assert.deepEqual(result, {
    ok: true,
    prompt: "见图",
    config: {
      provider: "omp/xai-oauth/grok-4.6",
      thinkingOptionId: "high",
      modeId: "full",
    },
    imageIds: ["img-1", "img-2"],
  });
});

test("records the newest run at the front and sets lastAgentId", () => {
  const next = applyTaskRun(task, {
    agentId: "agent-9",
    createdAt: "2026-08-24T12:00:00.000Z",
    promptPreview: "先复现再改",
  });
  assert.equal(next.lastAgentId, "agent-9");
  assert.equal(next.updatedAt, "2026-08-24T12:00:00.000Z");
  assert.equal(next.runs[0]?.agentId, "agent-9");
  assert.equal(next.runs[0]?.promptPreview, "先复现再改");
  assert.equal(next.runs[0]?.createdAt, "2026-08-24T12:00:00.000Z");
  assert.ok(next.runs[0]?.id);
});
