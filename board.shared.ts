import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const taskStatusSchema = z.enum(["open", "done"]);

export const taskImageSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number(),
  createdAt: z.string(),
  thumbBase64: z.string().optional(),
});

export const taskRunSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  createdAt: z.string(),
  promptPreview: z.string(),
});

export const publicTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  status: taskStatusSchema,
  openRank: z.number(),
  images: z.array(taskImageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  lastAgentId: z.string().nullable(),
  runs: z.array(taskRunSchema),
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  thinkingOptionId: z.string().nullable().default(null),
  modeId: z.string().nullable().default(null),
});

export const workspaceInput = z.object({
  workspaceId: z.string(),
});

export const getBoardRpc = defineRpc({
  name: "tasks.get-board",
  input: workspaceInput,
  output: z.object({
    projectId: z.string(),
    tasks: z.array(publicTaskSchema),
  }),
});

export const createTaskRpc = defineRpc({
  name: "tasks.create",
  input: workspaceInput.extend({
    title: z.string().optional(),
    body: z.string().optional(),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    thinkingOptionId: z.string().nullable().optional(),
    modeId: z.string().nullable().optional(),
  }),
  output: z.object({ task: publicTaskSchema }),
});

export const updateTaskRpc = defineRpc({
  name: "tasks.update",
  input: workspaceInput.extend({
    taskId: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    thinkingOptionId: z.string().nullable().optional(),
    modeId: z.string().nullable().optional(),
  }),
  output: z.object({ task: publicTaskSchema }),
});

export const setStatusRpc = defineRpc({
  name: "tasks.set-status",
  input: workspaceInput.extend({
    taskId: z.string(),
    status: taskStatusSchema,
  }),
  output: z.object({ task: publicTaskSchema }),
});

export const reorderOpenRpc = defineRpc({
  name: "tasks.reorder-open",
  input: workspaceInput.extend({
    orderedIds: z.array(z.string()),
  }),
  output: z.object({ tasks: z.array(publicTaskSchema) }),
});

export const removeTaskRpc = defineRpc({
  name: "tasks.remove",
  input: workspaceInput.extend({
    taskId: z.string(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const addImageRpc = defineRpc({
  name: "tasks.add-image",
  input: workspaceInput.extend({
    taskId: z.string(),
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataBase64: z.string(),
  }),
  output: z.object({ task: publicTaskSchema }),
});

export const removeImageRpc = defineRpc({
  name: "tasks.remove-image",
  input: workspaceInput.extend({
    taskId: z.string(),
    imageId: z.string(),
  }),
  output: z.object({ task: publicTaskSchema }),
});

export const readImageRpc = defineRpc({
  name: "tasks.read-image",
  input: workspaceInput.extend({
    taskId: z.string(),
    imageId: z.string(),
  }),
  output: z.object({
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataBase64: z.string(),
  }),
});

export const recordRunRpc = defineRpc({
  name: "tasks.record-run",
  input: workspaceInput.extend({
    taskId: z.string(),
    agentId: z.string(),
    promptPreview: z.string(),
  }),
  output: z.object({ task: publicTaskSchema }),
});

export type PublicTask = z.infer<typeof publicTaskSchema>;
