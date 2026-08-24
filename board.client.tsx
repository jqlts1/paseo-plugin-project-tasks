import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin";
import { useCallback, useMemo, useState } from "react";
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

type Screen = { name: "open" } | { name: "done" } | { name: "task"; taskId: string };

export function TasksPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, ({ name, projectId }) => ({ name, projectId }));
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
  const [screen, setScreen] = useState<Screen>({ name: "open" });
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
    mutationFn: () => createTask({ workspaceId }),
    onSuccess: (data) => {
      invalidate();
      setScreen({ name: "task", taskId: data.task.id });
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
      setScreen({ name: "open" });
    },
  });
  const addImageMut = useMutation({
    mutationFn: (input: { taskId: string; mime: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string }) =>
      addImage({ workspaceId, ...input }),
    onSuccess: invalidate,
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

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: compact ? 16 : 24,
        gap: compact ? 8 : 12,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: compact ? 20 : 24 },
      muted: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
      row: {
        padding: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        gap: 6,
      },
      rowTitle: { color: theme.colors.foreground, fontWeight: "600" as const },
      preview: { color: theme.colors.foregroundMuted },
      thumbs: { flexDirection: "row" as const, gap: 6 },
      thumb: { width: 40, height: 40, borderRadius: 6, backgroundColor: theme.colors.foregroundMuted },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground },
      ghost: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
      ghostText: { color: theme.colors.foreground },
      input: {
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        padding: 10,
        minHeight: 40,
      },
      body: {
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        padding: 10,
        minHeight: 180,
        textAlignVertical: "top" as const,
      },
    }),
    [compact, theme],
  );

  const selected = screen.name === "task" ? tasks.find((task) => task.id === screen.taskId) : undefined;

  const move = (taskId: string, kind: "up" | "down" | "top") => {
    const ids = openTasks.map((task) => task.id);
    const from = ids.indexOf(taskId);
    if (from < 0) return;
    const next = ids.slice();
    next.splice(from, 1);
    if (kind === "top") next.unshift(taskId);
    else if (kind === "up") next.splice(Math.max(0, from - 1), 0, taskId);
    else next.splice(Math.min(ids.length - 1, from + 1), 0, taskId);
    reorderMut.mutate(next);
  };

  const attachFiles = async (taskId: string, files: Array<{ mime: string; dataBase64: string }>) => {
    for (const file of files.slice(0, 3)) {
      if (file.mime !== "image/png" && file.mime !== "image/jpeg" && file.mime !== "image/webp") continue;
      await addImageMut.mutateAsync({ taskId, mime: file.mime, dataBase64: file.dataBase64 });
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Tasks</Text>
      <Text style={styles.muted}>
        {workspace?.name ?? workspaceId}
        {workspace?.projectId ? ` · ${workspace.projectId}` : ""}
      </Text>
      {boardQuery.error ? <Text style={styles.error}>{String(boardQuery.error.message)}</Text> : null}

      {screen.name === "open" ? (
        <ScrollView>
          <View style={{ gap: 10 }}>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => createMut.mutate()}>
                <Text style={styles.buttonText}>{createMut.isPending ? "Creating…" : "New task"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => setScreen({ name: "done" })}>
                <Text style={styles.ghostText}>Completed ({doneTasks.length})</Text>
              </Pressable>
            </View>
            {visibleOpen.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                style={styles.row}
                onPress={() => setScreen({ name: "task", taskId: task.id })}
                onHoverIn={webDrag ? () => reorder.over(task.id) : undefined}
                onPointerUp={webDrag ? reorder.end : undefined}
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
                <View style={styles.actions}>
                  {webDrag ? (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.ghost}
                      onPointerDown={() => reorder.start(task.id)}
                    >
                      <Text style={styles.ghostText}>Drag</Text>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => move(task.id, "top")}>
                        <Text style={styles.ghostText}>Top</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => move(task.id, "up")}>
                        <Text style={styles.ghostText}>Up</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => move(task.id, "down")}>
                        <Text style={styles.ghostText}>Down</Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    style={styles.ghost}
                    onPress={() => statusMut.mutate({ taskId: task.id, status: "done" })}
                  >
                    <Text style={styles.ghostText}>Done</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
            {visibleOpen.length === 0 && !boardQuery.isLoading ? (
              <Text style={styles.muted}>No open tasks.</Text>
            ) : null}
          </View>
        </ScrollView>
      ) : null}

      {screen.name === "done" ? (
        <ScrollView>
          <View style={{ gap: 10 }}>
            <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => setScreen({ name: "open" })}>
              <Text style={styles.ghostText}>Back to open</Text>
            </Pressable>
            {doneTasks.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                style={styles.row}
                onPress={() => setScreen({ name: "task", taskId: task.id })}
              >
                <Text style={styles.rowTitle}>{task.title}</Text>
                <Text style={styles.preview}>{task.completedAt}</Text>
              </Pressable>
            ))}
            {doneTasks.length === 0 ? <Text style={styles.muted}>Nothing completed yet.</Text> : null}
          </View>
        </ScrollView>
      ) : null}

      {screen.name === "task" && selected ? (
        <TaskDetail
          task={selected}
          styles={styles}
          placeholderColor={theme.colors.foregroundMuted}
          workspaceId={workspaceId}
          readImage={readImage}
          onBack={() => setScreen(selected.status === "done" ? { name: "done" } : { name: "open" })}
          onTitle={(title) => updateMut.mutate({ taskId: selected.id, title })}
          onBody={(body) => updateMut.mutate({ taskId: selected.id, body })}
          onStatus={(status) => statusMut.mutate({ taskId: selected.id, status })}
          onRemove={() => removeMut.mutate(selected.id)}
          onPick={async () => {
            try {
              const files = await pickLocalImages();
              await attachFiles(selected.id, files);
            } catch (error) {
              console.error(error);
            }
          }}
          onPaste={async (files) => {
            await attachFiles(selected.id, files);
          }}
          onRemoveImage={(imageId) => removeImageMut.mutate({ taskId: selected.id, imageId })}
          busy={addImageMut.isPending || updateMut.isPending}
          error={addImageMut.error?.message ?? updateMut.error?.message ?? removeMut.error?.message}
        />
      ) : null}

      {screen.name === "task" && !selected && !boardQuery.isLoading ? (
        <Text style={styles.muted}>Task not found.</Text>
      ) : null}
    </View>
  );
}

function TaskDetail({
  task,
  styles,
  placeholderColor,
  workspaceId,
  readImage,
  onBack,
  onTitle,
  onBody,
  onStatus,
  onRemove,
  onPick,
  onPaste,
  onRemoveImage,
  busy,
  error,
}: {
  task: PublicTask;
  styles: Record<string, object>;
  placeholderColor: string;
  workspaceId: string;
  readImage: (input: { workspaceId: string; taskId: string; imageId: string }) => Promise<{
    mime: "image/png" | "image/jpeg" | "image/webp";
    dataBase64: string;
  }>;
  onBack: () => void;
  onTitle: (title: string) => void;
  onBody: (body: string) => void;
  onStatus: (status: "open" | "done") => void;
  onRemove: () => void;
  onPick: () => void;
  onPaste: (files: Array<{ mime: string; dataBase64: string }>) => void;
  onRemoveImage: (imageId: string) => void;
  busy: boolean;
  error?: string;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [full, setFull] = useState<Record<string, string>>({});

  const loadFull = async (imageId: string) => {
    if (full[imageId]) return;
    const image = await readImage({ workspaceId, taskId: task.id, imageId });
    setFull((current) => ({ ...current, [imageId]: `data:${image.mime};base64,${image.dataBase64}` }));
  };

  return (
    <ScrollView
      onStartShouldSetResponder={() => true}
      // @ts-expect-error web paste
      onPaste={(event: { nativeEvent?: { clipboardData?: DataTransfer } }) => {
        const files = clipboardFiles(event.nativeEvent?.clipboardData);
        if (files.length === 0) return;
        void Promise.all(files.map(fileToPayload)).then(onPaste);
      }}
    >
      <View style={{ gap: 10 }}>
        <Pressable accessibilityRole="button" style={styles.ghost} onPress={onBack}>
          <Text style={styles.ghostText}>Back</Text>
        </Pressable>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onEndEditing={() => onTitle(title)}
          style={styles.input}
          placeholder="Title"
          placeholderTextColor={placeholderColor}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          onEndEditing={() => onBody(body)}
          style={styles.body}
          multiline
          placeholder="Notes / future prompt"
          placeholderTextColor={placeholderColor}
        />
        <View style={styles.thumbs}>
          {task.images.map((image) => {
            const uri = full[image.id] ?? (image.thumbBase64 ? `data:${image.mime};base64,${image.thumbBase64}` : undefined);
            if (!full[image.id] && !image.thumbBase64) void loadFull(image.id);
            return (
              <Pressable key={image.id} onPress={() => onRemoveImage(image.id)}>
                {uri ? <Image source={{ uri }} style={{ width: 96, height: 96, borderRadius: 8 }} /> : <View style={{ width: 96, height: 96 }} />}
                <Text style={styles.muted}>Remove</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" style={styles.button} onPress={onPick} disabled={busy || task.images.length >= 3}>
            <Text style={styles.buttonText}>{busy ? "Saving…" : "Add image"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.ghost}
            onPress={() => onStatus(task.status === "open" ? "done" : "open")}
          >
            <Text style={styles.ghostText}>{task.status === "open" ? "Mark done" : "Reopen"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.ghost} onPress={onRemove}>
            <Text style={styles.ghostText}>Delete</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </ScrollView>
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
    throw new Error("File picker is only available on desktop/web. Add the image from a computer.");
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.multiple = true;
  const files = await new Promise<File[]>((resolve) => {
    input.onchange = () => resolve(Array.from(input.files ?? []));
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
  const comma = dataUrl.indexOf(",");
  return { mime: file.type || "image/png", dataBase64: dataUrl.slice(comma + 1) };
}
