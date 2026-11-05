import type { EditorState, StateEffect } from "@codemirror/state";

export interface Buffer {
  state: EditorState;
  scroll: StateEffect<unknown>;
}

// Open-file state lives here, not in the view, so undo history, cursor and
// scroll position survive switching tabs. It is memory only until Rust can save.
export const buffers = new Map<string, Buffer>();
