import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PluginWorkspacePanelProps,
  usePaseo,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  addImageRpc,
  createTaskRpc,
  getBoardRpc,
  readImageRpc,
  removeImageRpc,
  removeTaskRpc,
  reorderOpenRpc,
  setStatusRpc,
  updateTaskRpc,
  type PublicTask,
} from "./board.shared";
import { prepareComposerSubmission, type ComposerImagePayload, type ComposerSubmission } from "./composer-draft";
import { useWebReorder } from "./reorder.client";

type Screen = { name: "list" } | { name: "task"; taskId: string };
type BoardData = { projectId: string; tasks: PublicTask[] };
type CreateInput = {
  title?: string;
  body?: string;
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
};
type StatusInput = { taskId: string; status: "open" | "done" };
type UndoDone = { taskId: string; title: string };

const BOARD_KEY = "project-tasks";
type TimerId = number | NodeJS.Timeout;
const UNDO_MS = 5000;
const SAVE_DEBOUNCE_MS = 800;

type RunModel = {
  provider: string;
  id: string;
  label: string;
  thinkingOptions: { id: string; label: string; isDefault?: boolean }[];
  defaultThinkingOptionId?: string | null;
};

let lastRun = {
  provider: "omp" as string | null,
  model: "xai-oauth/grok-4.6" as string | null,
  thinkingOptionId: null as string | null,
};

export function TasksPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, ({ name }) => ({ name }));
  const queryClient = useQueryClient();
  const getBoard = useRpc(getBoardRpc);
  const createTask = useRpc(createTaskRpc);
  const updateTask = useRpc(updateTaskRpc);
  const setStatus = useRpc(setStatusRpc);
  const reorderOpen = useRpc(reorderOpenRpc);
  const removeTask = useRpc(removeTaskRpc);
  const addImage = useRpc(addImageRpc);
  const removeImage = useRpc(removeImageRpc);
  const readImage = useRpc(readImageRpc);
  const [screen, setScreen] = useState<Screen>({ name: "list" });
  const [showDone, setShowDone] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoDone | null>(null);
  const undoTimerRef = useRef<TimerId>(0);
  const compact = layout.compact;
  const webDrag = layout.platform === "web" && !compact;
  const boardKey = [BOARD_KEY, workspaceId] as const;

  const boardQuery = useQuery({
    queryKey: boardKey,
    queryFn: () => getBoard({ workspaceId }),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: boardKey });
  }, [queryClient, workspaceId]);

  const showError = (error: unknown) => {
    setPickError(error instanceof Error ? error.message : String(error));
  };

  const createMut = useMutation({
    mutationFn: (input: CreateInput) => createTask({ workspaceId, ...input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardData>(boardKey);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (previous) {
        queryClient.setQueryData<BoardData>(boardKey, {
          ...previous,
          tasks: [...previous.tasks, optimisticTask(previous.tasks, input, tempId)],
        });
      }
      return { previous, tempId };
    },
    onSuccess: (data, _input, ctx) => {
      queryClient.setQueryData<BoardData>(boardKey, (current) => {
        if (!current) return current;
        const withoutTemp = current.tasks.filter((task) => task.id !== ctx?.tempId && task.id !== data.task.id);
        return { ...current, tasks: [...withoutTemp, data.task] };
      });
    },
    onError: (error, _input, ctx) => {
      if (ctx?.tempId) {
        queryClient.setQueryData<BoardData>(boardKey, (current) =>
          current ? { ...current, tasks: current.tasks.filter((task) => task.id !== ctx.tempId) } : current,
        );
      }
      showError(error);
    },
    onSettled: invalidate,
  });

  const updateMut = useMutation({
    mutationFn: (input: { taskId: string; title?: string; body?: string }) =>
      updateTask({ workspaceId, ...input }),
    onSuccess: invalidate,
    onError: showError,
  });

  const statusMut = useMutation({
    mutationFn: (input: StatusInput) => setStatus({ workspaceId, ...input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardData>(boardKey);
      if (previous) {
        queryClient.setQueryData<BoardData>(boardKey, {
          ...previous,
          tasks: previous.tasks.map((task) => applyStatus(previous.tasks, task, input)),
        });
      }
      return { previous };
    },
    onError: (error, input, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(boardKey, ctx.previous);
      if (input.status === "done") clearUndo();
      showError(error);
    },
    onSettled: invalidate,
  });

  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderOpen({ workspaceId, orderedIds }),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardData>(boardKey);
      if (previous) {
        const rankById = new Map(orderedIds.map((id, index) => [id, index]));
        queryClient.setQueryData<BoardData>(boardKey, {
          ...previous,
          tasks: previous.tasks.map((task) => {
            const rank = rankById.get(task.id);
            return rank === undefined ? task : { ...task, openRank: rank, updatedAt: new Date().toISOString() };
          }),
        });
      }
      return { previous };
    },
    onError: (error, _ids, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(boardKey, ctx.previous);
      showError(error);
    },
    onSettled: invalidate,
  });

  const removeMut = useMutation({
    mutationFn: (taskId: string) => removeTask({ workspaceId, taskId }),
    onSuccess: () => {
      invalidate();
      setScreen({ name: "list" });
    },
    onError: showError,
  });
  const addImageMut = useMutation({
    mutationFn: (input: {
      taskId: string;
      mime: "image/png" | "image/jpeg" | "image/webp";
      dataBase64: string;
    }) => addImage({ workspaceId, ...input }),
    onSuccess: () => {
      setPickError(null);
      invalidate();
    },
    onError: showError,
  });
  const removeImageMut = useMutation({
    mutationFn: (input: { taskId: string; imageId: string }) => removeImage({ workspaceId, ...input }),
    onSuccess: invalidate,
    onError: showError,
  });

  const tasks = boardQuery.data?.tasks ?? [];
  const openTasks = [...tasks.filter((task) => task.status === "open")].sort((a, b) => a.openRank - b.openRank);
  const doneTasks = [...tasks.filter((task) => task.status === "done")].sort((a, b) =>
    (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
  );
  const openIds = openTasks.map((task) => task.id);
  const reorder = useWebReorder(webDrag, openIds, (ids) => reorderMut.mutate(ids));
  const visibleOpen = reorder.previewIds
    .map((id) => openTasks.find((task) => task.id === id))
    .filter((task): task is PublicTask => Boolean(task));
  const selected = screen.name === "task" ? tasks.find((task) => task.id === screen.taskId) : undefined;

  const clearUndo = () => {
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = 0;
    setUndo(null);
  };

  const armUndo = (task: PublicTask) => {
    clearTimeout(undoTimerRef.current);
    setUndo({ taskId: task.id, title: task.title });
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = 0;
      setUndo(null);
    }, UNDO_MS);
  };

  useEffect(() => {
    return () => {
      clearTimeout(undoTimerRef.current);
    };
  }, []);


  const completeTask = (task: PublicTask) => {
    armUndo(task);
    statusMut.mutate({ taskId: task.id, status: "done" });
  };

  const undoComplete = () => {
    if (!undo) return;
    const taskId = undo.taskId;
    clearUndo();
    statusMut.mutate({ taskId, status: "open" });
  };

  const move = (taskId: string, kind: "up" | "down") => {
    const ids = openTasks.map((task) => task.id);
    const from = ids.indexOf(taskId);
    if (from < 0) return;
    const to = kind === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return;
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, taskId);
    reorderMut.mutate(next);
  };

  const attachFiles = async (taskId: string, files: Array<{ mime: string; dataBase64: string }>) => {
    const room = 3 - (queryClient.getQueryData<BoardData>(boardKey)?.tasks.find((task) => task.id === taskId)?.images.length ?? 0);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (file.mime !== "image/png" && file.mime !== "image/jpeg" && file.mime !== "image/webp") continue;
      await addImageMut.mutateAsync({ taskId, mime: file.mime, dataBase64: file.dataBase64 });
    }
  };

  const submitComposer = async (submission: ComposerSubmission): Promise<{ warning?: string }> => {
    setPickError(null);
    const created = await createMut.mutateAsync(submission.create);
    let failedImages = 0;
    for (const image of submission.images) {
      try {
        await addImageMut.mutateAsync({
          taskId: created.task.id,
          mime: image.mime,
          dataBase64: image.dataBase64,
        });
      } catch {
        failedImages += 1;
      }
    }
    if (failedImages === 0) return {};
    const warning = `任务已创建，${failedImages} 张图片上传失败`;
    setPickError(warning);
    return { warning };
  };

  const c = theme.colors;
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: c.surface0 },
      header: {
        paddingHorizontal: compact ? 16 : 20,
        paddingTop: compact ? 12 : 16,
        paddingBottom: 8,
        gap: 2,
      },
      title: { color: c.foreground, fontSize: compact ? 20 : 22, fontWeight: "600" as const },
      muted: { color: c.foregroundMuted, fontSize: 13 },
      error: { color: c.statusDanger, fontSize: 13 },
      list: { flex: 1 },
      listBody: { paddingHorizontal: compact ? 12 : 16, paddingBottom: 24, gap: 2 },
      openList: { gap: 2 },
      row: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 8,
        gap: 10,
        borderLeftWidth: 3,
        borderLeftColor: c.surface0,
      },
      rowCurrent: { borderLeftColor: c.accent },
      rowDragging: { opacity: 0.45 },
      handle: { width: 18, paddingTop: 3 },
      handleText: { color: c.foregroundMuted, fontSize: 14, letterSpacing: -1 },
      check: {
        width: 20,
        height: 20,
        marginTop: 2,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: c.foregroundMuted,
      },
      checkDone: {
        width: 20,
        height: 20,
        marginTop: 2,
        borderRadius: 10,
        backgroundColor: c.accent,
      },
      rowMain: { flex: 1, gap: 3 },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexWrap: "wrap" as const },
      rowTitle: { color: c.foreground, fontSize: 16, lineHeight: 22, flexShrink: 1 },
      currentBadge: { color: c.accent, fontSize: 11, fontWeight: "600" as const },
      rowTitleDone: { color: c.foregroundMuted, fontSize: 16, lineHeight: 22, textDecorationLine: "line-through" as const },
      preview: { color: c.foregroundMuted, fontSize: 13, lineHeight: 18 },
      thumbs: { flexDirection: "row" as const, gap: 6, marginTop: 4 },
      thumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: c.foregroundMuted },
      stepper: { flexDirection: "row" as const, gap: 4, paddingTop: 1 },
      step: { paddingHorizontal: 6, paddingVertical: 2 },
      stepText: { color: c.foregroundMuted, fontSize: 16 },
      undoBar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: compact ? 12 : 16,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: c.foregroundMuted,
        backgroundColor: c.surface0,
      },
      undoText: { flex: 1, color: c.foregroundMuted, fontSize: 13 },
      undoAction: { color: c.accent, fontSize: 13, fontWeight: "600" as const },
      composer: {
        paddingHorizontal: compact ? 12 : 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: c.foregroundMuted,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      composerInput: { flex: 1, color: c.foreground, fontSize: 16, paddingVertical: 8 },
      addBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: c.accent },
      addBtnText: { color: c.accentForeground, fontSize: 14 },
      doneToggle: { paddingVertical: 12, paddingHorizontal: 8 },
      doneToggleText: { color: c.foregroundMuted, fontSize: 13 },
      empty: { paddingVertical: 28, paddingHorizontal: 8 },
      emptyTitle: { color: c.foreground, fontSize: 16, marginBottom: 4 },
    }),
    [c, compact],
  );

  const listError = pickError ?? asMessage(boardQuery.error) ?? asMessage(createMut.error) ?? asMessage(statusMut.error) ?? asMessage(reorderMut.error);

  if (screen.name === "task" && selected) {
    return (
      <TaskDetail
        key={selected.id}
        task={selected}
        theme={theme}
        compact={compact}
        placeholderColor={withAlpha(c.foreground, 0.38)}
        workspaceId={workspaceId}
        readImage={readImage}
        busy={addImageMut.isPending || updateMut.isPending || removeMut.isPending}
        error={pickError ?? asMessage(addImageMut.error) ?? asMessage(updateMut.error) ?? asMessage(removeMut.error)}
        onBack={() => setScreen({ name: "list" })}
        onSave={(patch) => updateMut.mutate({ taskId: selected.id, ...patch })}
        onStatus={(status) => {
          if (status === "done") completeTask(selected);
          else statusMut.mutate({ taskId: selected.id, status });
          if (status === "done") setScreen({ name: "list" });
        }}
        onRemove={() => removeMut.mutate(selected.id)}
        onPick={async () => {
          try {
            setPickError(null);
            const files = await pickLocalImages();
            await attachFiles(selected.id, files);
          } catch (error) {
            showError(error);
          }
        }}
        onPaste={(files) => void attachFiles(selected.id, files)}
        onRemoveImage={(imageId) => removeImageMut.mutate({ taskId: selected.id, imageId })}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>任务</Text>
        <Text style={styles.muted}>
          {workspace?.name ?? "当前工作区"}
          {openTasks.length > 0 ? ` · ${openTasks.length} 项未完成` : ""}
        </Text>
        {listError ? <Text style={styles.error}>{listError}</Text> : null}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listBody}
        keyboardShouldPersistTaps="handled"
      >
        {visibleOpen.length === 0 && !boardQuery.isLoading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有未完成的任务</Text>
            <Text style={styles.muted}>在下面输入，回车即可添加。</Text>
          </View>
        ) : null}

        <View nativeID={reorder.listNativeId} style={styles.openList}>
        {visibleOpen.map((task, index) => {
          const isCurrent = index === 0;
          return (
          <View
            key={task.id}
            nativeID={reorder.rowNativeId(task.id)}
            style={[styles.row, isCurrent ? styles.rowCurrent : null, reorder.draggingId === task.id ? styles.rowDragging : null]}
          >
            {webDrag ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="拖动排序"
                style={styles.handle}
                onPointerDown={(event) => reorder.start(task.id, event)}
              >
                <Text style={styles.handleText}>⋮⋮</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: false }}
              accessibilityLabel="完成"
              onPress={() => {
                if (reorder.blocked) return;
                completeTask(task);
              }}
              style={styles.check}
            />
            <Pressable
              accessibilityRole="button"
              style={styles.rowMain}
              onPress={() => {
                if (reorder.blocked) return;
                setScreen({ name: "task", taskId: task.id });
              }}
            >
              <View style={styles.titleRow}>
                <Text style={styles.rowTitle}>{task.title}</Text>
                {isCurrent ? <Text style={styles.currentBadge}>当前</Text> : null}
              </View>
              {task.body.trim() ? (
                <Text style={styles.preview} numberOfLines={1}>
                  {task.body.trim().split("\n")[0]}
                </Text>
              ) : null}
              {task.images.length > 0 ? <Text style={styles.preview}>图 {task.images.length}</Text> : null}
            </Pressable>
            {compact ? (
              <View style={styles.stepper}>
                <Pressable accessibilityRole="button" style={styles.step} onPress={() => move(task.id, "up")}>
                  <Text style={styles.stepText}>↑</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.step} onPress={() => move(task.id, "down")}>
                  <Text style={styles.stepText}>↓</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          );
        })}
        </View>

        {doneTasks.length > 0 ? (
          <View>
            <Pressable accessibilityRole="button" style={styles.doneToggle} onPress={() => setShowDone((value) => !value)}>
              <Text style={styles.doneToggleText}>
                {showDone ? "收起已完成" : "已完成"} · {doneTasks.length}
              </Text>
            </Pressable>
            {showDone
              ? doneTasks.map((task) => (
                  <View key={task.id} style={styles.row}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: true }}
                      accessibilityLabel="重新打开"
                      onPress={() => statusMut.mutate({ taskId: task.id, status: "open" })}
                      style={styles.checkDone}
                    />
                    <Pressable
                      accessibilityRole="button"
                      style={styles.rowMain}
                      onPress={() => setScreen({ name: "task", taskId: task.id })}
                    >
                      <Text style={styles.rowTitleDone}>{task.title}</Text>
                      <Text style={styles.preview} numberOfLines={1}>
                        {relativeTime(task.completedAt ?? task.updatedAt)}
                      </Text>
                      {task.body.trim() ? (
                        <Text style={styles.preview} numberOfLines={1}>
                          {task.body.trim().split("\n")[0]}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>

      {undo ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoText} numberOfLines={1}>
            已完成“{undo.title.trim().length <= 18 ? undo.title.trim() : `${undo.title.trim().slice(0, 18)}…`}”
          </Text>
          <Pressable accessibilityRole="button" onPress={undoComplete}>
            <Text style={styles.undoAction}>撤销</Text>
          </Pressable>
        </View>
      ) : null}

      <TaskComposer
        theme={theme}
        compact={compact}
        submitting={createMut.isPending || addImageMut.isPending}
        onSubmit={submitComposer}
      />
    </View>
  );
}

function TaskComposer({
  theme,
  compact,
  submitting,
  onSubmit,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  compact: boolean;
  submitting: boolean;
  onSubmit: (submission: ComposerSubmission) => Promise<{ warning?: string }>;
}) {
  const paseo = usePaseo();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<ComposerImagePayload[]>([]);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<RunModel[]>([]);
  const [provider, setProvider] = useState(lastRun.provider);
  const [model, setModel] = useState(lastRun.model);
  const [thinkingOptionId, setThinkingOptionId] = useState(lastRun.thinkingOptionId);
  const [menu, setMenu] = useState<null | "model" | "thinking">(null);
  const titleRef = useRef<TextInput>(null);
  const submitRef = useRef<() => void>(() => {});
  const escapeArmedRef = useRef(false);
  const c = theme.colors;
  const hint = withAlpha(c.foreground, 0.38);
  const busy = submitting || localSubmitting;
  const hasDraft = Boolean(title.trim() || body.trim() || images.length);
  const selectedModel = models.find((item) => item.id === model && item.provider === provider) ?? models.find((item) => item.id === model);
  const thinkingOptions = selectedModel?.thinkingOptions ?? [];

  const addImages = async (payloads: ComposerImagePayload[]) => {
    const allowed = payloads.filter(
      (image) => image.mime === "image/png" || image.mime === "image/jpeg" || image.mime === "image/webp",
    );
    if (allowed.length === 0) return;
    setExpanded(true);
    setImages((current) => [...current, ...allowed].slice(0, 3));
    setError(null);
    setTimeout(() => titleRef.current?.focus(), 0);
  };

  const submit = async () => {
    if (busy) return;
    const submission = prepareComposerSubmission({ title, body, images });
    if (!submission) return;
    setLocalSubmitting(true);
    setError(null);
    lastRun = { provider, model, thinkingOptionId };
    try {
      const result = await onSubmit({
        create: {
          ...submission.create,
          provider,
          model,
          thinkingOptionId,
        },
        images: submission.images,
      });
      setTitle("");
      setBody("");
      setImages([]);
      setExpanded(true);
      setMenu(null);
      escapeArmedRef.current = false;
      setError(result.warning ?? null);
      setTimeout(() => titleRef.current?.focus(), 0);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setLocalSubmitting(false);
    }
  };
  submitRef.current = () => void submit();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onPaste = (event: Event) => {
      const clip = "clipboardData" in event ? (event as ClipboardEvent).clipboardData : null;
      const files = clipboardFiles(clip ?? undefined);
      if (files.length === 0) return;
      event.preventDefault();
      void Promise.all(files.slice(0, 3).map(fileToPayload)).then(addImages);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void paseo.providers
      .snapshot()
      .then((snap: { entries?: Array<{
        provider: string;
        enabled?: boolean;
        models?: Array<{
          id: string;
          label: string;
          isSelectable?: boolean;
          defaultThinkingOptionId?: string;
          thinkingOptions?: Array<{ id: string; label: string; isDefault?: boolean }>;
        }>;
      }> }) => {
        if (cancelled) return;
        const next: RunModel[] = [];
        for (const entry of snap.entries ?? []) {
          if (entry.enabled === false) continue;
          for (const item of entry.models ?? []) {
            if (item.isSelectable === false) continue;
            next.push({
              provider: entry.provider,
              id: item.id,
              label: item.label,
              thinkingOptions: (item.thinkingOptions ?? []).map((option) => ({
                id: option.id,
                label: option.label,
                isDefault: option.isDefault,
              })),
              defaultThinkingOptionId: item.defaultThinkingOptionId,
            });
          }
        }
        setModels(next);
        const preferred =
          next.find((item) => item.id === lastRun.model && item.provider === lastRun.provider) ??
          next.find((item) => item.id.includes("grok-4.6")) ??
          next[0];
        if (preferred) {
          setProvider(preferred.provider);
          setModel(preferred.id);
          const thinking =
            lastRun.thinkingOptionId && preferred.thinkingOptions.some((option) => option.id === lastRun.thinkingOptionId)
              ? lastRun.thinkingOptionId
              : preferred.defaultThinkingOptionId ?? preferred.thinkingOptions.find((option) => option.isDefault)?.id ?? preferred.thinkingOptions[0]?.id ?? null;
          setThinkingOptionId(thinking);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, paseo]);

  useEffect(() => {
    if (!expanded || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitRef.current();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (hasDraft && !escapeArmedRef.current) {
        escapeArmedRef.current = true;
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      setExpanded(false);
      escapeArmedRef.current = false;
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, hasDraft]);

  const line = withAlpha(c.foregroundMuted, 0.28);
  const field = {
    borderWidth: 0,
  };
  const styles = {
    collapsed: {
      minHeight: 48,
      paddingHorizontal: compact ? 16 : 20,
      borderTopWidth: 1,
      borderTopColor: line,
      justifyContent: "center" as const,
    },
    collapsedText: { color: c.foregroundMuted, fontSize: 16 },
    wrap: {
      paddingHorizontal: compact ? 12 : 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: line,
      backgroundColor: c.surface0,
    },
    card: {
      borderWidth: 1,
      borderColor: line,
      borderRadius: 12,
      paddingTop: compact ? 10 : 12,
      paddingHorizontal: compact ? 12 : 14,
      paddingBottom: compact ? 10 : 12,
      gap: 6,
      backgroundColor: c.surface0,
      boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
    },
    title: {
      ...field,
      color: c.foreground,
      fontSize: 17,
      fontWeight: "600" as const,
      paddingVertical: 6,
      paddingHorizontal: 0,
    },
    body: {
      ...field,
      color: c.foreground,
      fontSize: 14,
      lineHeight: 21,
      minHeight: 68,
      textAlignVertical: "top" as const,
      paddingVertical: 4,
      paddingHorizontal: 0,
    },
    thumbs: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, paddingTop: 4 },
    thumbWrap: { width: 58, gap: 2 },
    thumb: { width: 58, height: 58, borderRadius: 7, backgroundColor: withAlpha(c.foregroundMuted, 0.2) },
    removeImage: { color: c.statusDanger, fontSize: 11, textAlign: "center" as const },
    footer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 8,
      minHeight: compact ? 44 : 36,
      marginTop: 4,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: line,
    },
    tools: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 6, flexShrink: 1 },
    imageButton: { minHeight: compact ? 44 : 32, justifyContent: "center" as const, paddingHorizontal: 2 },
    imageButtonText: { color: c.foregroundMuted, fontSize: 13 },
    chip: {
      minHeight: compact ? 32 : 28,
      paddingHorizontal: 8,
      borderRadius: 8,
      justifyContent: "center" as const,
      backgroundColor: withAlpha(c.foregroundMuted, 0.12),
    },
    chipText: { color: c.foreground, fontSize: 12 },
    menu: {
      maxHeight: 180,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    menuRow: { paddingHorizontal: 10, paddingVertical: 8 },
    menuRowOn: { backgroundColor: withAlpha(c.accent, 0.12) },
    menuText: { color: c.foreground, fontSize: 13 },
    menuMuted: { color: c.foregroundMuted, fontSize: 11 },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    cancel: {
      minHeight: compact ? 44 : 34,
      justifyContent: "center" as const,
      paddingHorizontal: compact ? 10 : 8,
    },
    cancelText: { color: c.foregroundMuted, fontSize: 14 },
    add: {
      minHeight: compact ? 44 : 34,
      justifyContent: "center" as const,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: c.accent,
      opacity: !hasDraft || busy ? 0.55 : 1,
    },
    addText: { color: c.accentForeground, fontSize: 14, fontWeight: "600" as const },
    error: { color: c.statusDanger, fontSize: 12 },
  };

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        style={styles.collapsed}
        onPress={() => {
          setExpanded(true);
          setTimeout(() => titleRef.current?.focus(), 0);
        }}
      >
        <Text style={styles.collapsedText}>＋ 添加任务</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <TextInput
          ref={titleRef}
          value={title}
          onChangeText={(value) => {
            escapeArmedRef.current = false;
            setTitle(value);
          }}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          returnKeyType="done"
          placeholder="任务标题"
          placeholderTextColor={hint}
          underlineColorAndroid="transparent"
          style={[styles.title, webNoOutline()]}
          autoFocus
        />
        <TextInput
          value={body}
          onChangeText={(value) => {
            escapeArmedRef.current = false;
            setBody(value);
          }}
          multiline
          placeholder="备注，也可以是一段完整 prompt"
          placeholderTextColor={hint}
          underlineColorAndroid="transparent"
          style={[styles.body, webNoOutline()]}
        />
        {images.length > 0 ? (
          <View style={styles.thumbs}>
            {images.map((image, index) => (
              <View key={`${image.mime}-${index}`} style={styles.thumbWrap}>
                <Image source={{ uri: `data:${image.mime};base64,${image.dataBase64}` }} style={styles.thumb} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setImages((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                >
                  <Text style={styles.removeImage}>移除</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.footer}>
          <View style={styles.tools}>
            <Pressable
              accessibilityRole="button"
              style={styles.imageButton}
              disabled={images.length >= 3 || busy}
              onPress={async () => {
                try {
                  await addImages(await pickLocalImages());
                } catch (pickFailure) {
                  if (pickFailure instanceof Error && pickFailure.message === "已取消") return;
                  setError(pickFailure instanceof Error ? pickFailure.message : String(pickFailure));
                }
              }}
            >
              <Text style={styles.imageButtonText}>＋ 图片 {images.length}/3</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.chip}
              onPress={() => setMenu((current) => (current === "model" ? null : "model"))}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {selectedModel?.label ?? model ?? "选择模型"}
              </Text>
            </Pressable>
            {thinkingOptions.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                style={styles.chip}
                onPress={() => setMenu((current) => (current === "thinking" ? null : "thinking"))}
              >
                <Text style={styles.chipText}>
                  {thinkingOptions.find((option) => option.id === thinkingOptionId)?.label ?? "思考"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              style={styles.cancel}
              onPress={() => {
                setExpanded(false);
                escapeArmedRef.current = false;
              }}
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.add} disabled={!hasDraft || busy} onPress={submit}>
              <Text style={styles.addText}>{busy ? "添加中…" : "添加任务"}</Text>
            </Pressable>
          </View>
        </View>
        {menu === "model" ? (
          <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled">
            {models.map((item) => (
              <Pressable
                key={`${item.provider}:${item.id}`}
                style={[styles.menuRow, item.id === model ? styles.menuRowOn : null]}
                onPress={() => {
                  setProvider(item.provider);
                  setModel(item.id);
                  setThinkingOptionId(
                    item.defaultThinkingOptionId ?? item.thinkingOptions.find((option) => option.isDefault)?.id ?? item.thinkingOptions[0]?.id ?? null,
                  );
                  setMenu(null);
                }}
              >
                <Text style={styles.menuText}>{item.label}</Text>
                <Text style={styles.menuMuted}>{item.provider}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {menu === "thinking" ? (
          <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled">
            {thinkingOptions.map((option) => (
              <Pressable
                key={option.id}
                style={[styles.menuRow, option.id === thinkingOptionId ? styles.menuRowOn : null]}
                onPress={() => {
                  setThinkingOptionId(option.id);
                  setMenu(null);
                }}
              >
                <Text style={styles.menuText}>{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

function TaskDetail({
  task,
  theme,
  compact,
  placeholderColor,
  workspaceId,
  readImage,
  onBack,
  onSave,
  onStatus,
  onRemove,
  onPick,
  onPaste,
  onRemoveImage,
  busy,
  error,
}: {
  task: PublicTask;
  theme: PluginWorkspacePanelProps["theme"];
  compact: boolean;
  placeholderColor: string;
  workspaceId: string;
  readImage: (input: { workspaceId: string; taskId: string; imageId: string }) => Promise<{
    mime: "image/png" | "image/jpeg" | "image/webp";
    dataBase64: string;
  }>;
  onBack: () => void;
  onSave: (patch: { title?: string; body?: string }) => void;
  onStatus: (status: "open" | "done") => void;
  onRemove: () => void;
  onPick: () => void;
  onPaste: (files: Array<{ mime: string; dataBase64: string }>) => void;
  onRemoveImage: (imageId: string) => void;
  busy: boolean;
  error?: string | null;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [full, setFull] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const taskRef = useRef(task);
  const onSaveRef = useRef(onSave);
  const lastSentRef = useRef({ title: task.title, body: task.body });
  const timerRef = useRef<TimerId>(0);
  const c = theme.colors;
  titleRef.current = title;
  bodyRef.current = body;
  taskRef.current = task;
  onSaveRef.current = onSave;
  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = 0;
    const current = taskRef.current;
    const nextTitle = titleRef.current.trim();
    const sent = lastSentRef.current;
    const resolvedTitle = nextTitle || current.title;
    const titleChanged = resolvedTitle !== sent.title && (nextTitle.length > 0 || current.title.length > 0);
    const bodyChanged = bodyRef.current !== sent.body;
    if (!titleChanged && !bodyChanged) return;
    const patch = {
      ...(titleChanged ? { title: resolvedTitle } : {}),
      ...(bodyChanged ? { body: bodyRef.current } : {}),
    };
    lastSentRef.current = {
      title: titleChanged ? resolvedTitle : sent.title,
      body: bodyChanged ? bodyRef.current : sent.body,
    };
    onSaveRef.current(patch);
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = 0;
      flush();
    }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => {
    setTitle(task.title);
    setBody(task.body);
    lastSentRef.current = { title: task.title, body: task.body };
  }, [task.id, task.title, task.body]);

  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  const loadFull = async (imageId: string) => {
    if (full[imageId]) return;
    const image = await readImage({ workspaceId, taskId: task.id, imageId });
    setFull((current) => ({ ...current, [imageId]: `data:${image.mime};base64,${image.dataBase64}` }));
  };

  const styles = {
    screen: { flex: 1, backgroundColor: c.surface0 },
    top: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: compact ? 12 : 16,
      paddingTop: compact ? 10 : 14,
      paddingBottom: 8,
    },
    back: { color: c.accent, fontSize: 16 },
    body: { flex: 1, paddingHorizontal: compact ? 16 : 20, paddingBottom: 24, gap: 12 },
    title: {
      color: c.foreground,
      fontSize: 22,
      fontWeight: "600" as const,
      paddingVertical: 4,
      borderWidth: 0,
    },
    notes: {
      color: c.foreground,
      fontSize: 16,
      lineHeight: 24,
      minHeight: 160,
      textAlignVertical: "top" as const,
      borderWidth: 0,
    },
    section: { color: c.foregroundMuted, fontSize: 13 },
    thumbs: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 10 },
    shot: { gap: 4, width: 108 },
    image: { width: 108, height: 108, borderRadius: 8, backgroundColor: c.foregroundMuted },
    remove: { color: c.statusDanger, fontSize: 13 },
    actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, marginTop: 8 },
    button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: c.accent },
    buttonText: { color: c.accentForeground },
    ghostText: { color: c.foreground, paddingVertical: 8, paddingHorizontal: 8 },
    dangerText: { color: c.statusDanger, paddingVertical: 8, paddingHorizontal: 8 },
    error: { color: c.statusDanger, fontSize: 13 },
  };

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            flush();
            onBack();
          }}
        >
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            flush();
            onStatus(task.status === "open" ? "done" : "open");
          }}
        >
          <Text style={styles.back}>{task.status === "open" ? "完成" : "重新打开"}</Text>
        </Pressable>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        // @ts-expect-error web paste
        onPaste={(event: { nativeEvent?: { clipboardData?: DataTransfer } }) => {
          const files = clipboardFiles(event.nativeEvent?.clipboardData);
          if (files.length > 0) void Promise.all(files.map(fileToPayload)).then(onPaste);
        }}
      >
        <TextInput
          value={title}
          onChangeText={(value) => {
            titleRef.current = value;
            setTitle(value);
            scheduleSave();
          }}
          onBlur={flush}
          style={[styles.title, webNoOutline()]}
          placeholder="任务标题"
          placeholderTextColor={placeholderColor}
          underlineColorAndroid="transparent"
        />
        <TextInput
          value={body}
          onChangeText={(value) => {
            bodyRef.current = value;
            setBody(value);
            scheduleSave();
          }}
          onBlur={flush}
          style={[styles.notes, webNoOutline()]}
          multiline
          placeholder="备注，也可以是一段以后要发给 agent 的说明"
          placeholderTextColor={placeholderColor}
          underlineColorAndroid="transparent"
        />
        <Text style={styles.section}>图片 {task.images.length}/3</Text>
        <View style={styles.thumbs}>
          {task.images.map((image) => {
            const uri =
              full[image.id] ?? (image.thumbBase64 ? `data:${image.mime};base64,${image.thumbBase64}` : undefined);
            if (!uri) void loadFull(image.id);
            return (
              <View key={image.id} style={styles.shot}>
                {uri ? <Image source={{ uri }} style={styles.image} /> : <View style={styles.image} />}
                <Pressable accessibilityRole="button" onPress={() => onRemoveImage(image.id)}>
                  <Text style={styles.remove}>删除图片</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.button} onPress={onPick} disabled={busy || task.images.length >= 3}>
            <Text style={styles.buttonText}>{busy ? "处理中…" : "添加图片"}</Text>
          </Pressable>
          {confirmDelete ? (
            <>
              <Pressable accessibilityRole="button" onPress={onRemove}>
                <Text style={styles.dangerText}>确认删除任务</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(false)}>
                <Text style={styles.ghostText}>取消</Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)}>
              <Text style={styles.dangerText}>删除任务</Text>
            </Pressable>
          )}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

function clipboardFiles(data: DataTransfer | undefined): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (fromFiles.length > 0) return fromFiles;
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) fromItems.push(file);
    }
  }
  return fromItems;
}

async function pickLocalImages(): Promise<ComposerImagePayload[]> {
  if (typeof document === "undefined") {
    throw new Error("当前端不能选文件，请在电脑上添加图片。");
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.multiple = true;
  const files = await new Promise<File[]>((resolve, reject) => {
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => reject(new Error("已取消"));
    input.click();
  });
  return Promise.all(files.map(fileToPayload));
}

async function fileToPayload(file: File): Promise<ComposerImagePayload> {
  if (file.type !== "image/png" && file.type !== "image/jpeg" && file.type !== "image/webp") {
    throw new Error("只支持 PNG、JPEG 和 WebP 图片");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { mime: file.type, dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
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
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) {
    return withAlpha(hex.slice(0, 7), alpha);
  }
  return color;
}

function clockLabel(prefix: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${prefix} ${hh}:${mm}`;
}

function asMessage(error: unknown): string | null {
  if (error == null) return null;
  return error instanceof Error ? error.message : String(error);
}

function nextOpenRank(tasks: PublicTask[]): number {
  const ranks = tasks.filter((task) => task.status === "open").map((task) => task.openRank);
  return ranks.length === 0 ? 0 : Math.max(...ranks) + 1;
}

function optimisticTask(tasks: PublicTask[], input: CreateInput, id: string): PublicTask {
  const now = new Date().toISOString();
  const firstBodyLine = input.body?.trim().split("\n")[0]?.trim() ?? "";
  return {
    id,
    title: input.title?.trim() || firstBodyLine.slice(0, 40) || clockLabel("任务"),
    body: input.body ?? "",
    status: "open",
    openRank: nextOpenRank(tasks),
    images: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastAgentId: null,
    runs: [],
    provider: input.provider ?? null,
    model: input.model ?? null,
    thinkingOptionId: input.thinkingOptionId ?? null,
  };
}

function applyStatus(tasks: PublicTask[], task: PublicTask, input: StatusInput): PublicTask {
  if (task.id !== input.taskId || task.status === input.status) return task;
  const now = new Date().toISOString();
  if (input.status === "done") {
    return { ...task, status: "done", completedAt: now, updatedAt: now };
  }
  const others = tasks.filter((item) => item.status === "open" && item.id !== task.id);
  return {
    ...task,
    status: "open",
    completedAt: null,
    openRank: nextOpenRank(others),
    updatedAt: now,
  };
}


function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(day / 365)} 年前`;
}
