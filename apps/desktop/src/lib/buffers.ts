import type { EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface Buffer {
  state: EditorState;
  scroll: StateEffect<unknown>;
}

// Open-file state lives here, not in the view, so undo history, cursor and
// scroll position survive switching tabs.
export const buffers = new Map<string, Buffer>();

/** The editor showing each open file right now, if it's on screen. */
export const views = new Map<string, EditorView>();
