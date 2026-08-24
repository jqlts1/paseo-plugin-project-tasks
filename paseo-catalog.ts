export type CatalogModel = {
  provider: string;
  providerLabel: string;
  id: string;
  label: string;
  description: string;
  thinkingOptions: { id: string; label: string; isDefault?: boolean }[];
  defaultThinkingOptionId?: string | null;
};

export type CatalogPack = {
  provider: string;
  defaultModeId?: string | null;
  modes: { id: string; label: string }[];
};

export type Catalog = {
  models: CatalogModel[];
  packs: CatalogPack[];
};

export type StoredRun = {
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
};

type SnapshotModel = {
  id: string;
  label: string;
  description?: string;
  isSelectable?: boolean;
  defaultThinkingOptionId?: string | null;
  thinkingOptions?: Array<{ id: string; label: string; isDefault?: boolean }>;
};

type SnapshotEntry = {
  provider: string;
  label?: string;
  status?: string;
  models?: SnapshotModel[];
  defaultModeId?: string | null;
  modes?: Array<{ id: string; label?: string }>;
};

export type CatalogSnapshot = { entries?: SnapshotEntry[] | null };

function isSnapshotEntry(value: unknown): value is SnapshotEntry {
  return Boolean(value && typeof value === "object" && "provider" in value && typeof value.provider === "string");
}

export function catalogSnapshotFromUnknown(value: unknown): CatalogSnapshot {
  if (!value || typeof value !== "object" || !("entries" in value) || !Array.isArray(value.entries)) {
    return { entries: [] };
  }
  return { entries: value.entries.filter(isSnapshotEntry) };
}

export function buildRunnableCatalog(snapshot: { entries?: SnapshotEntry[] | null }): Catalog {
  const models: CatalogModel[] = [];
  const packs: CatalogPack[] = [];
  for (const entry of snapshot.entries ?? []) {
    if (entry.status !== "ready") continue;
    const providerLabel = entry.label ?? entry.provider;
    packs.push({
      provider: entry.provider,
      defaultModeId: entry.defaultModeId,
      modes: (entry.modes ?? []).map((mode) => ({ id: mode.id, label: mode.label ?? mode.id })),
    });
    for (const item of entry.models ?? []) {
      if (item.isSelectable === false) continue;
      models.push({
        provider: entry.provider,
        providerLabel,
        id: item.id,
        label: item.label,
        description: item.description ?? item.id,
        thinkingOptions: (item.thinkingOptions ?? []).map((option) => ({
          id: option.id,
          label: option.label,
          isDefault: option.isDefault,
        })),
        defaultThinkingOptionId: item.defaultThinkingOptionId,
      });
    }
  }
  return { models, packs };
}

export function filterCatalogModels(models: CatalogModel[], query: string): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter((item) =>
    [item.label, item.id, item.provider, item.providerLabel, item.description].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export function findCatalogModel(
  models: CatalogModel[],
  selection: StoredRun | null | undefined,
): CatalogModel | undefined {
  if (!selection?.model) return undefined;
  return (
    models.find((item) => item.id === selection.model && item.provider === selection.provider) ??
    models.find((item) => item.id === selection.model)
  );
}

function defaultThinking(model: CatalogModel): string | null {
  return (
    model.defaultThinkingOptionId ??
    model.thinkingOptions.find((option) => option.isDefault)?.id ??
    model.thinkingOptions[0]?.id ??
    null
  );
}

function defaultMode(pack: CatalogPack | undefined): string | null {
  return pack?.defaultModeId ?? pack?.modes.find((mode) => mode.id === "full")?.id ?? pack?.modes[0]?.id ?? null;
}

function clampRun(catalog: Catalog, model: CatalogModel, selection: StoredRun | null | undefined): StoredRun {
  const pack = catalog.packs.find((entry) => entry.provider === model.provider);
  const thinking =
    (selection?.thinkingOptionId &&
      model.thinkingOptions.some((option) => option.id === selection.thinkingOptionId) &&
      selection.thinkingOptionId) ||
    defaultThinking(model);
  const mode =
    (selection?.modeId && pack?.modes.some((item) => item.id === selection.modeId) && selection.modeId) ||
    defaultMode(pack);
  return {
    provider: model.provider,
    model: model.id,
    thinkingOptionId: thinking,
    modeId: mode,
  };
}

export function reconcileSelection(
  catalog: Catalog,
  current?: StoredRun | null,
  preferred?: StoredRun | null,
): StoredRun | null {
  const currentModel = findCatalogModel(catalog.models, current);
  if (currentModel) return clampRun(catalog, currentModel, current);
  const preferredModel = findCatalogModel(catalog.models, preferred);
  if (preferredModel) return clampRun(catalog, preferredModel, preferred);
  const first = catalog.models[0];
  return first ? clampRun(catalog, first, null) : null;
}
