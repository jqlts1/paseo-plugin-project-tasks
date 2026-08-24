import type { PluginContext } from "@getpaseo/plugin";
import { TasksPanel } from "./board.client";
import {
  addImage,
  createTask,
  getBoard,
  readImage,
  recordRun,
  removeImage,
  removeTask,
  reorderOpen,
  setStatus,
  updateTask,
} from "./board.server";
import {
  addImageRpc,
  createTaskRpc,
  getBoardRpc,
  readImageRpc,
  recordRunRpc,
  removeImageRpc,
  removeTaskRpc,
  reorderOpenRpc,
  setStatusRpc,
  updateTaskRpc,
} from "./board.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getBoardRpc, getBoard);
  plugin.handle(createTaskRpc, createTask);
  plugin.handle(updateTaskRpc, updateTask);
  plugin.handle(recordRunRpc, recordRun);
  plugin.handle(setStatusRpc, setStatus);
  plugin.handle(reorderOpenRpc, reorderOpen);
  plugin.handle(removeTaskRpc, removeTask);
  plugin.handle(addImageRpc, addImage);
  plugin.handle(removeImageRpc, removeImage);
  plugin.handle(readImageRpc, readImage);
  plugin.addWorkspacePanel({
    id: "board",
    title: "Tasks",
    icon: "ListTodo",
    context: "workspace",
    Component: TasksPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-board",
    title: "Open tasks",
    icon: "ListTodo",
    keywords: ["todo", "task", "board"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("board");
    },
  });
  return () => {};
}
