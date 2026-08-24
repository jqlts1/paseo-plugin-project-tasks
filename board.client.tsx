import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useWebReorder } from "./reorder.client";

type Screen = { name: "list" } | { name: "task"; taskId: string };

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
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const compact = layout.compact;
  const webDrag = layout.platform === "web" && !compact;

  const boardQuery = useQuery({
    queryKey: ["project-tasks", workspaceId],
    queryFn: () => getBoard({ workspaceId }),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["project-tasks", workspaceId] });
  }, [queryClient, workspaceId]);

  const createMut = useMutation({
    mutationFn: (title: string) => createTask({ workspaceId, title }),
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
  });
  const updateMut = useMutation({
    mutationFn: (input: { taskId: string; title?: string; body?: string }) =>
      updateTask({ workspaceId, ...input }),
    onSuccess: invalidate,
  });
  const statusMut = useMutation({
    mutationFn: (input: { taskId: string; status: "open" | "done" }) =>
      setStatus({ workspaceId, ...input }),
    onSuccess: invalidate,
  });
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderOpen({ workspaceId, orderedIds }),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (taskId: string) => removeTask({ workspaceId, taskId }),
    onSuccess: () => {
      invalidate();
      setScreen({ name: "list" });
    },
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
    onError: (error: Error) => setPickError(error.message),
  });
  const removeImageMut = useMutation({
    mutationFn: (input: { taskId: string; imageId: string }) => removeImage({ workspaceId, ...input }),
    onSuccess: invalidate,
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

  const submitDraft = () => {
    const title = draft.trim();
    if (!title || createMut.isPending) return;
    createMut.mutate(title);
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
    const room = 3 - (tasks.find((task) => task.id === taskId)?.images.length ?? 0);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (file.mime !== "image/png" && file.mime !== "image/jpeg" && file.mime !== "image/webp") continue;
      await addImageMut.mutateAsync({ taskId, mime: file.mime, dataBase64: file.dataBase64 });
    }
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
      },
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
      rowTitle: { color: c.foreground, fontSize: 16, lineHeight: 22 },
      rowTitleDone: { color: c.foregroundMuted, fontSize: 16, lineHeight: 22, textDecorationLine: "line-through" as const },
      preview: { color: c.foregroundMuted, fontSize: 13, lineHeight: 18 },
      thumbs: { flexDirection: "row" as const, gap: 6, marginTop: 4 },
      thumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: c.foregroundMuted },
      stepper: { flexDirection: "row" as const, gap: 4, paddingTop: 1 },
      step: { paddingHorizontal: 6, paddingVertical: 2 },
      stepText: { color: c.foregroundMuted, fontSize: 16 },
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

  if (screen.name === "task" && selected) {
    return (
      <TaskDetail
        key={selected.id}
        task={selected}
        theme={theme}
        compact={compact}
        placeholderColor={c.foregroundMuted}
        workspaceId={workspaceId}
        readImage={readImage}
        busy={addImageMut.isPending || updateMut.isPending || removeMut.isPending}
        error={pickError ?? addImageMut.error?.message ?? updateMut.error?.message ?? removeMut.error?.message}
        onBack={() => setScreen({ name: "list" })}
        onSave={(patch) => updateMut.mutate({ taskId: selected.id, ...patch })}
        onStatus={(status) => {
          statusMut.mutate({ taskId: selected.id, status });
          if (status === "done") setScreen({ name: "list" });
        }}
        onRemove={() => removeMut.mutate(selected.id)}
        onPick={async () => {
          try {
            setPickError(null);
            const files = await pickLocalImages();
            await attachFiles(selected.id, files);
          } catch (error) {
            setPickError(error instanceof Error ? error.message : String(error));
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
        {boardQuery.error ? <Text style={styles.error}>{boardQuery.error.message}</Text> : null}
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listBody} keyboardShouldPersistTaps="handled">
        {visibleOpen.length === 0 && !boardQuery.isLoading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有未完成的任务</Text>
            <Text style={styles.muted}>在下面输入，回车即可添加。</Text>
          </View>
        ) : null}

        <View nativeID={reorder.listNativeId} style={styles.openList}>
        {visibleOpen.map((task) => (
          <View
            key={task.id}
            nativeID={reorder.rowNativeId(task.id)}
            style={[styles.row, reorder.draggingId === task.id ? styles.rowDragging : null]}
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
                statusMut.mutate({ taskId: task.id, status: "done" });
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
              <Text style={styles.rowTitle}>{task.title}</Text>
              {task.body.trim() ? (
                <Text style={styles.preview} numberOfLines={1}>
                  {task.body.trim().split("\n")[0]}
                </Text>
              ) : null}
              {task.images.length > 0 ? (
                <View style={styles.thumbs}>
                  {task.images.map((image) =>
                    image.thumbBase64 ? (
                      <Image
                        key={image.id}
                        source={{ uri: `data:${image.mime};base64,${image.thumbBase64}` }}
                        style={styles.thumb}
                      />
                    ) : (
                      <View key={image.id} style={styles.thumb} />
                    ),
                  )}
                </View>
              ) : null}
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
        ))}
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
                    </Pressable>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>

      {screen.name === "list" ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            blurOnSubmit
            returnKeyType="done"
            placeholder="添加任务"
            placeholderTextColor={c.foregroundMuted}
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            style={styles.addBtn}
            onPress={submitDraft}
            disabled={!draft.trim() || createMut.isPending}
          >
            <Text style={styles.addBtnText}>{createMut.isPending ? "…" : "添加"}</Text>
          </Pressable>
        </View>
      ) : null}
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
  const c = theme.colors;

  useEffect(() => {
    setTitle(task.title);
    setBody(task.body);
  }, [task.id, task.title, task.body]);

  const flush = () => {
    const nextTitle = title.trim();
    const titleChanged = nextTitle !== task.title && (nextTitle.length > 0 || task.title.length > 0);
    const bodyChanged = body !== task.body;
    if (titleChanged || bodyChanged) {
      onSave({
        ...(titleChanged ? { title: nextTitle || task.title } : {}),
        ...(bodyChanged ? { body } : {}),
      });
    }
  };

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
    title: { color: c.foreground, fontSize: 22, fontWeight: "600" as const, paddingVertical: 4 },
    notes: {
      color: c.foreground,
      fontSize: 16,
      lineHeight: 24,
      minHeight: 160,
      textAlignVertical: "top" as const,
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
          onPress={() => onStatus(task.status === "open" ? "done" : "open")}
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
          onChangeText={setTitle}
          onBlur={flush}
          style={styles.title}
          placeholder="任务标题"
          placeholderTextColor={placeholderColor}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          onBlur={flush}
          style={styles.notes}
          multiline
          placeholder="备注，也可以是一段以后要发给 agent 的说明"
          placeholderTextColor={placeholderColor}
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

async function pickLocalImages(): Promise<Array<{ mime: string; dataBase64: string }>> {
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

async function fileToPayload(file: File): Promise<{ mime: string; dataBase64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { mime: file.type || "image/png", dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
