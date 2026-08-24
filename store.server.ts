import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { boardPath, imagePath, imagesDir, projectDir } from "./paths.server";
import type { PublicTask } from "./board.shared";

export type TaskImage = PublicTask["images"][number];
export type Task = PublicTask;

export type BoardFile = {
  version: 1;
  projectId: string;
  tasks: Task[];
  updatedAt: string;
};

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_THUMB_BYTES = 64 * 1024;

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type ImageMime = keyof typeof MIME_EXT;

function nowIso(): string {
  return new Date().toISOString();
}

function clockLabel(prefix: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${prefix} ${hh}:${mm}`;
}

export function defaultTitle(title: string | undefined, body: string, kind: "task" | "shot"): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  const first = body.trim().split("\n")[0]?.trim() ?? "";
  if (first) return first.slice(0, 40);
  return clockLabel(kind === "shot" ? "截图" : "任务");
}

function emptyBoard(projectId: string): BoardFile {
  return { version: 1, projectId, tasks: [], updatedAt: nowIso() };
}

export function loadBoard(projectId: string): BoardFile {
  const path = boardPath(projectId);
  if (!existsSync(path)) {
    const board = emptyBoard(projectId);
    saveBoard(board);
    return board;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BoardFile;
  if (parsed.version !== 1 || parsed.projectId !== projectId || !Array.isArray(parsed.tasks)) {
    throw new Error("board.json is not a v1 project-tasks file");
  }
  return parsed;
}

export function saveBoard(board: BoardFile): void {
  mkdirSync(projectDir(board.projectId), { recursive: true });
  board.updatedAt = nowIso();
  writeFileSync(boardPath(board.projectId), `${JSON.stringify(board, null, 2)}\n`, "utf8");
}

function withThumb(projectId: string, task: Task, image: TaskImage): TaskImage {
  const fullPath = imagePath(projectId, task.id, image.filename);
  if (!existsSync(fullPath)) return image;
  const bytes = readFileSync(fullPath);
  if (bytes.length > MAX_THUMB_BYTES) return image;
  return { ...image, thumbBase64: bytes.toString("base64") };
}

export function publicTasks(projectId: string, tasks: Task[]): Task[] {
  return tasks.map((task) => ({
    ...task,
    images: task.images.map((image) => withThumb(projectId, task, image)),
  }));
}

function nextOpenRank(tasks: Task[]): number {
  const ranks = tasks.filter((task) => task.status === "open").map((task) => task.openRank);
  return ranks.length === 0 ? 0 : Math.max(...ranks) + 1;
}

export type TaskPatch = {
  title?: string;
  body?: string;
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
};

export function createTask(projectId: string, input: TaskPatch = {}): Task {
  const board = loadBoard(projectId);
  const text = input.body ?? "";
  const task: Task = {
    id: crypto.randomUUID(),
    title: defaultTitle(input.title, text, "task"),
    body: text,
    status: "open",
    openRank: nextOpenRank(board.tasks),
    images: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    lastAgentId: null,
    runs: [],
    provider: input.provider ?? null,
    model: input.model ?? null,
    thinkingOptionId: input.thinkingOptionId ?? null,
    modeId: input.modeId ?? null,
  };
  board.tasks.push(task);
  saveBoard(board);
  return task;
}

function requireTask(board: BoardFile, taskId: string): Task {
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("task not found");
  return task;
}

export function updateTask(projectId: string, taskId: string, patch: TaskPatch): Task {
  const board = loadBoard(projectId);
  const task = requireTask(board, taskId);
  if (patch.title !== undefined) task.title = defaultTitle(patch.title, patch.body ?? task.body, "task");
  if (patch.body !== undefined) {
    task.body = patch.body;
    if (!patch.title && !task.title.trim()) task.title = defaultTitle(undefined, patch.body, "task");
  }
  if (patch.provider !== undefined) task.provider = patch.provider;
  if (patch.model !== undefined) task.model = patch.model;
  if (patch.thinkingOptionId !== undefined) task.thinkingOptionId = patch.thinkingOptionId;
  if (patch.modeId !== undefined) task.modeId = patch.modeId;
  task.updatedAt = nowIso();
  saveBoard(board);
  return task;
}

export function setTaskStatus(projectId: string, taskId: string, status: "open" | "done"): Task {
  const board = loadBoard(projectId);
  const task = requireTask(board, taskId);
  if (task.status === status) return task;
  task.status = status;
  task.updatedAt = nowIso();
  if (status === "done") {
    task.completedAt = nowIso();
  } else {
    task.completedAt = null;
    task.openRank = nextOpenRank(board.tasks.filter((item) => item.id !== task.id));
  }
  saveBoard(board);
  return task;
}

export function reorderOpen(projectId: string, orderedIds: string[]): Task[] {
  const board = loadBoard(projectId);
  const open = board.tasks.filter((task) => task.status === "open");
  const openIds = new Set(open.map((task) => task.id));
  if (orderedIds.length !== open.length || orderedIds.some((id) => !openIds.has(id))) {
    throw new Error("orderedIds must list every open task once");
  }
  const rankById = new Map(orderedIds.map((id, index) => [id, index]));
  for (const task of open) {
    task.openRank = rankById.get(task.id) ?? task.openRank;
    task.updatedAt = nowIso();
  }
  saveBoard(board);
  return board.tasks;
}

export function removeTask(projectId: string, taskId: string): void {
  const board = loadBoard(projectId);
  requireTask(board, taskId);
  board.tasks = board.tasks.filter((task) => task.id !== taskId);
  saveBoard(board);
  rmSync(imagesDir(projectId, taskId), { recursive: true, force: true });
}

export function addImage(projectId: string, taskId: string, mime: ImageMime, dataBase64: string): Task {
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length === 0) throw new Error("image is empty");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("image exceeds 5 MiB");
  const board = loadBoard(projectId);
  const task = requireTask(board, taskId);
  if (task.images.length >= MAX_IMAGES) throw new Error("task already has 3 images");
  const imageId = crypto.randomUUID();
  const filename = `${imageId}.${MIME_EXT[mime]}`;
  mkdirSync(imagesDir(projectId, task.id), { recursive: true });
  writeFileSync(imagePath(projectId, task.id, filename), bytes);
  const image: TaskImage = {
    id: imageId,
    filename,
    mime,
    bytes: bytes.length,
    createdAt: nowIso(),
  };
  task.images.push(image);
  if (!task.title.trim() || task.title.startsWith("任务 ")) {
    task.title = defaultTitle(undefined, task.body, "shot");
  }
  task.updatedAt = nowIso();
  saveBoard(board);
  return task;
}

export function removeImage(projectId: string, taskId: string, imageId: string): Task {
  const board = loadBoard(projectId);
  const task = requireTask(board, taskId);
  const image = task.images.find((item) => item.id === imageId);
  if (!image) throw new Error("image not found");
  task.images = task.images.filter((item) => item.id !== imageId);
  task.updatedAt = nowIso();
  saveBoard(board);
  rmSync(imagePath(projectId, task.id, image.filename), { force: true });
  return task;
}

export function readImage(projectId: string, taskId: string, imageId: string): { mime: ImageMime; dataBase64: string } {
  const board = loadBoard(projectId);
  const task = requireTask(board, taskId);
  const image = task.images.find((item) => item.id === imageId);
  if (!image) throw new Error("image not found");
  const bytes = readFileSync(imagePath(projectId, task.id, image.filename));
  return { mime: image.mime, dataBase64: bytes.toString("base64") };
}
