import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRunnableCatalog,
  catalogSnapshotFromUnknown,
  filterCatalogModels,
  reconcileSelection,
} from "./paseo-catalog";

const grok = {
  id: "xai-oauth/grok-4.6",
  label: "Grok 4.6",
  description: "default grok",
  thinkingOptions: [
    { id: "low", label: "Low" },
    { id: "high", label: "High", isDefault: true },
  ],
  defaultThinkingOptionId: "high",
};

const sonnet = {
  id: "claude-sonnet-4",
  label: "Sonnet 4",
  description: "coding",
  isSelectable: true,
  thinkingOptions: [{ id: "off", label: "Off", isDefault: true }],
};

const hidden = {
  id: "hidden-model",
  label: "Hidden",
  isSelectable: false,
};

const omp = {
  provider: "omp",
  label: "Oh My Pi",
  status: "ready" as const,
  defaultModeId: "full",
  modes: [
    { id: "full", label: "Full access" },
    { id: "ask", label: "Ask" },
  ],
  models: [grok, hidden],
};

const claude = {
  provider: "claude",
  label: "Claude",
  status: "ready" as const,
  modes: [{ id: "default", label: "Default" }],
  models: [sonnet],
};

test("keeps only ready providers and selectable models", () => {
  const catalog = buildRunnableCatalog({
    entries: [
      omp,
      { ...claude, status: "unavailable", models: [sonnet] },
      { provider: "codex", status: "error", models: [sonnet] },
      { provider: "loading", status: "loading", models: [sonnet] },
    ],
  });

  assert.deepEqual(
    catalog.models.map((item) => `${item.provider}:${item.id}`),
    ["omp:xai-oauth/grok-4.6"],
  );
  assert.equal(catalog.packs.length, 1);
  assert.equal(catalog.packs[0]?.provider, "omp");
});

test("treats a missing isSelectable flag as selectable", () => {
  const catalog = buildRunnableCatalog({ entries: [omp] });
  assert.equal(catalog.models[0]?.id, "xai-oauth/grok-4.6");
});

test("searches label, id, provider, and description", () => {
  const catalog = buildRunnableCatalog({ entries: [omp, claude] });
  assert.equal(filterCatalogModels(catalog.models, "sonnet").length, 1);
  assert.equal(filterCatalogModels(catalog.models, "omp").length, 1);
  assert.equal(filterCatalogModels(catalog.models, "coding").length, 1);
  assert.equal(filterCatalogModels(catalog.models, "missing").length, 0);
});

test("keeps the current selection when it is still runnable", () => {
  const catalog = buildRunnableCatalog({ entries: [omp, claude] });
  const next = reconcileSelection(catalog, {
    provider: "claude",
    model: "claude-sonnet-4",
    thinkingOptionId: "off",
    modeId: "default",
  });
  assert.deepEqual(next, {
    provider: "claude",
    model: "claude-sonnet-4",
    thinkingOptionId: "off",
    modeId: "default",
  });
});

test("rejects a stored model that left the ready catalog", () => {
  const catalog = buildRunnableCatalog({ entries: [omp] });
  const next = reconcileSelection(
    catalog,
    {
      provider: "claude",
      model: "claude-sonnet-4",
      thinkingOptionId: "off",
      modeId: "default",
    },
    {
      provider: "omp",
      model: "xai-oauth/grok-4.6",
      thinkingOptionId: "high",
      modeId: "full",
    },
  );
  assert.deepEqual(next, {
    provider: "omp",
    model: "xai-oauth/grok-4.6",
    thinkingOptionId: "high",
    modeId: "full",
  });
});

test("clamps thinking and mode to options that still exist", () => {
  const catalog = buildRunnableCatalog({ entries: [omp] });
  const next = reconcileSelection(catalog, {
    provider: "omp",
    model: "xai-oauth/grok-4.6",
    thinkingOptionId: "gone",
    modeId: "gone",
  });
  assert.deepEqual(next, {
    provider: "omp",
    model: "xai-oauth/grok-4.6",
    thinkingOptionId: "high",
    modeId: "full",
  });
});

test("returns null when no ready model exists", () => {
  const catalog = buildRunnableCatalog({
    entries: [{ provider: "omp", status: "error", models: [grok] }],
  });
  assert.equal(reconcileSelection(catalog, { provider: "omp", model: "xai-oauth/grok-4.6" }), null);
});

test("drops snapshot rows that are not provider entries", () => {
  const snap = catalogSnapshotFromUnknown({
    entries: [omp, { foo: 1 }, "bad", null],
  });
  assert.deepEqual(
    snap.entries?.map((entry) => entry.provider),
    ["omp"],
  );
});
