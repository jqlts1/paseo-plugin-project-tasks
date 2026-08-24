import { homedir } from "node:os";
import { join } from "node:path";

export function paseoHome(): string {
  return process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
}

export function projectDir(projectId: string): string {
  return join(paseoHome(), "plugin-data", "project-tasks", projectId);
}

export function boardPath(projectId: string): string {
  return join(projectDir(projectId), "board.json");
}

export function imagesDir(projectId: string, taskId: string): string {
  return join(projectDir(projectId), "images", taskId);
}

export function imagePath(projectId: string, taskId: string, filename: string): string {
  return join(imagesDir(projectId, taskId), filename);
}
