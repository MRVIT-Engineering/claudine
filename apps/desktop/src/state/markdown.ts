// Which open Markdown files show their preview instead of the editor. Per tab, for
// this run of the app only.
import { createStore } from "solid-js/store";
import { state } from "./store";

export const PREVIEW_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⇧⌘V"
  : "Ctrl+Shift+V";

const [previewing, setPreviewing] = createStore<Record<string, boolean>>({});

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function isPreviewing(path: string): boolean {
  return isMarkdown(path) && previewing[path] === true;
}

export function setMarkdownPreview(path: string, on: boolean) {
  setPreviewing(path, on);
}

/** Flips the active tab between its code and its preview. */
export function toggleMarkdownPreview() {
  const path = state.activeTab;
  if (path && isMarkdown(path)) setPreviewing(path, !previewing[path]);
}
