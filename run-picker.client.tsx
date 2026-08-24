import { usePaseo, type PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  buildRunnableCatalog,
  catalogSnapshotFromUnknown,
  filterCatalogModels,
  findCatalogModel,
  reconcileSelection,
  type Catalog,
  type CatalogModel,
  type StoredRun,
} from "./paseo-catalog";

export function useRunnableCatalog(cwd: string | null): Catalog {
  const paseo = usePaseo();
  const [catalog, setCatalog] = useState<Catalog>({ models: [], packs: [] });

  useEffect(() => {
    let cancelled = false;
    const options = cwd ? { cwd } : undefined;

    const applySnapshot = (value: unknown) => {
      if (cancelled) return;
      setCatalog(buildRunnableCatalog(catalogSnapshotFromUnknown(value)));
    };

    void (async () => {
      try {
        const snap =
          (await paseo.providers.waitForReady(options).catch(() => null)) ??
          (await paseo.providers.snapshot(options));
        if (cancelled) return;
        const parsed = catalogSnapshotFromUnknown(snap);
        const entries = [];
        for (const entry of parsed.entries ?? []) {
          if (entry.status !== "ready") {
            entries.push(entry);
            continue;
          }
          if ((entry.models ?? []).length > 0) {
            entries.push(entry);
            continue;
          }
          try {
            const extra = await paseo.providers.listModels(entry.provider, options);
            entries.push({ ...entry, models: extra.models ?? [] });
          } catch {
            entries.push(entry);
          }
        }
        applySnapshot({ entries });
      } catch {
        /* keep last catalog */
      }
    })();

    const unsubscribe = paseo.providers.subscribe((update: unknown) => {
      applySnapshot(update);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [paseo, cwd]);

  return catalog;
}

export function RunPicker({
  theme,
  catalog,
  selection,
  onChange,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  catalog: Catalog;
  selection: StoredRun;
  onChange: (next: StoredRun) => void;
}) {
  const [menu, setMenu] = useState<null | "model" | "thinking" | "mode">(null);
  const [modelQuery, setModelQuery] = useState("");
  const c = theme.colors;
  const hint = withAlpha(c.foreground, 0.38);
  const line = withAlpha(c.foregroundMuted, 0.28);
  const selectedModel = findCatalogModel(catalog.models, selection);
  const thinkingOptions = selectedModel?.thinkingOptions ?? [];
  const selectedPack = catalog.packs.find((pack) => pack.provider === (selectedModel?.provider ?? selection.provider));
  const modes = selectedPack?.modes ?? [];
  const selectedMode = modes.find((item) => item.id === selection.modeId) ?? modes[0];
  const visibleModels = filterCatalogModels(catalog.models, modelQuery);
  const styles = {
    tools: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 10 },
    ghost: { minHeight: 28, justifyContent: "center" as const },
    ghostText: { color: c.foregroundMuted, fontSize: 13 },
    ghostOn: { color: c.foreground, fontSize: 13 },
    menu: {
      maxHeight: 280,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 10,
      overflow: "hidden" as const,
      marginTop: 8,
    },
    search: {
      borderWidth: 0,
      color: c.foreground,
      fontSize: 14,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: line,
    },
    menuRow: { paddingHorizontal: 10, paddingVertical: 8 },
    menuRowHover: { backgroundColor: withAlpha(c.foregroundMuted, 0.14) },
    menuRowOn: { backgroundColor: withAlpha(c.accent, 0.12) },
    menuText: { color: c.foreground, fontSize: 13 },
    menuMuted: { color: c.foregroundMuted, fontSize: 11 },
    section: { color: c.foregroundMuted, fontSize: 11, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 },
  };

  const applyModel = (item: CatalogModel) => {
    const next = reconcileSelection(catalog, {
      provider: item.provider,
      model: item.id,
      thinkingOptionId: selection.thinkingOptionId,
      modeId: selection.modeId,
    });
    onChange(next ?? { provider: item.provider, model: item.id });
    setMenu(null);
  };

  return (
    <View>
      <View style={styles.tools}>
        <Pressable
          accessibilityRole="button"
          style={styles.ghost}
          onPress={() => {
            setModelQuery("");
            setMenu((current) => (current === "model" ? null : "model"));
          }}
        >
          <Text style={styles.ghostOn} numberOfLines={1}>
            {selectedModel?.label ??
              (selection.model ? "模型已不可用" : catalog.models.length === 0 ? "无可用模型" : "模型")}
          </Text>
        </Pressable>
        {thinkingOptions.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.ghost}
            onPress={() => setMenu((current) => (current === "thinking" ? null : "thinking"))}
          >
            <Text style={styles.ghostText}>
              {thinkingOptions.find((option) => option.id === selection.thinkingOptionId)?.label ?? "思考"}
            </Text>
          </Pressable>
        ) : null}
        {modes.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.ghost}
            onPress={() => setMenu((current) => (current === "mode" ? null : "mode"))}
          >
            <Text style={styles.ghostText}>{selectedMode?.label ?? "模式"}</Text>
          </Pressable>
        ) : null}
      </View>
      {menu === "model" ? (
        <View style={styles.menu}>
          <TextInput
            value={modelQuery}
            onChangeText={setModelQuery}
            placeholder="搜索模型"
            placeholderTextColor={hint}
            underlineColorAndroid="transparent"
            autoFocus
            style={[styles.search, webNoOutline()]}
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 230 }}>
            {visibleModels.length === 0 ? (
              <Text style={styles.section}>没有匹配的模型</Text>
            ) : (
              visibleModels.map((item, index) => {
                const showSection = index === 0 || visibleModels[index - 1]?.provider !== item.provider;
                return (
                  <View key={`${item.provider}:${item.id}`}>
                    {showSection ? <Text style={styles.section}>{item.providerLabel}</Text> : null}
                    <Pressable
                      accessibilityRole="button"
                      style={(state) => [
                        styles.menuRow,
                        pressableHovered(state) ? styles.menuRowHover : null,
                        item.id === selection.model && item.provider === selection.provider ? styles.menuRowOn : null,
                      ]}
                      onPress={() => applyModel(item)}
                    >
                      <Text style={styles.menuText}>{item.label}</Text>
                      <Text style={styles.menuMuted}>{item.description}</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
      {menu === "thinking" ? (
        <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled">
          {thinkingOptions.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              style={(state) => [
                styles.menuRow,
                pressableHovered(state) ? styles.menuRowHover : null,
                option.id === selection.thinkingOptionId ? styles.menuRowOn : null,
              ]}
              onPress={() => {
                onChange({ ...selection, thinkingOptionId: option.id });
                setMenu(null);
              }}
            >
              <Text style={styles.menuText}>{option.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {menu === "mode" ? (
        <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled">
          {modes.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              style={(state) => [
                styles.menuRow,
                pressableHovered(state) ? styles.menuRowHover : null,
                item.id === selection.modeId ? styles.menuRowOn : null,
              ]}
              onPress={() => {
                onChange({ ...selection, modeId: item.id });
                setMenu(null);
              }}
            >
              <Text style={styles.menuText}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function pressableHovered(state: object): boolean {
  return "hovered" in state && state.hovered === true;
}

function webNoOutline(): object {
  return { outlineWidth: 0, outlineStyle: "none" };
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${channel}`;
  }
  return color;
}
