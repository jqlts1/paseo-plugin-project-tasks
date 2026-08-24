import type { PluginHandlerContext } from "@getpaseo/plugin";
import type { output as ZodOutput } from "zod";
import {
  addImageRpc,
  createTaskRpc,
  getBoardRpc,
  publicTaskSchema,
  readImageRpc,
  removeImageRpc,
  removeTaskRpc,
  reorderOpenRpc,
  setStatusRpc,
  updateTaskRpc,
  type PublicTask,
} from "./board.shared";
import * as store from "./store.server";

async function projectIdOf(workspaceId: string, paseo: PluginHandlerContext["paseo"]): Promise<string> {
  const handle = paseo.workspaces.ref(workspaceId);
  const snapshot = (await handle.refresh()) ?? handle.current();
  const projectId = snapshot?.projectId ?? handle.projectId;
  if (!projectId) throw new Error("workspace has no projectId");
  return projectId;
}
function publish(projectId: string, task: PublicTask): PublicTask {
  return publicTaskSchema.parse(store.publicTasks(projectId, [task])[0]);
}

function publishAll(projectId: string, tasks: PublicTask[]): PublicTask[] {
  return store.publicTasks(projectId, tasks).map((task) => publicTaskSchema.parse(task));
}

export async function getBoard(
  input: ZodOutput<typeof getBoardRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const board = store.loadBoard(projectId);
  return { projectId, tasks: publishAll(projectId, board.tasks) };
}

export async function createTask(
  input: ZodOutput<typeof createTaskRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const task = store.createTask(projectId, {
    title: input.title,
    body: input.body,
    provider: input.provider,
    model: input.model,
    thinkingOptionId: input.thinkingOptionId,
    modeId: input.modeId,
  });
  return { task: publish(projectId, task) };
}

export async function updateTask(
  input: ZodOutput<typeof updateTaskRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const task = store.updateTask(projectId, input.taskId, {
    title: input.title,
    body: input.body,
    provider: input.provider,
    model: input.model,
    thinkingOptionId: input.thinkingOptionId,
    modeId: input.modeId,
  });
  return { task: publish(projectId, task) };
}

export async function setStatus(
  input: ZodOutput<typeof setStatusRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const task = store.setTaskStatus(projectId, input.taskId, input.status);
  return { task: publish(projectId, task) };
}

export async function reorderOpen(
  input: ZodOutput<typeof reorderOpenRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const tasks = store.reorderOpen(projectId, input.orderedIds);
  return { tasks: publishAll(projectId, tasks) };
}

export async function removeTask(
  input: ZodOutput<typeof removeTaskRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  store.removeTask(projectId, input.taskId);
  return { ok: true as const };
}

export async function addImage(
  input: ZodOutput<typeof addImageRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const task = store.addImage(projectId, input.taskId, input.mime, input.dataBase64);
  return { task: publish(projectId, task) };
}

export async function removeImage(
  input: ZodOutput<typeof removeImageRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  const task = store.removeImage(projectId, input.taskId, input.imageId);
  return { task: publish(projectId, task) };
}

export async function readImage(
  input: ZodOutput<typeof readImageRpc.input>,
  { paseo }: PluginHandlerContext,
) {
  const projectId = await projectIdOf(input.workspaceId, paseo);
  return store.readImage(projectId, input.taskId, input.imageId);
}
