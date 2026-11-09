import type { EditorView } from "@codemirror/view";
import { createSignal } from "solid-js";

// The editor that commands from the palette act on.
const [activeEditor, setActiveEditor] = createSignal<EditorView | null>(null);
// The Proposed side of the diff on screen, which Cmd+F searches when no editor is open.
const [reviewEditor, setReviewEditor] = createSignal<EditorView | null>(null);

export { activeEditor, reviewEditor, setActiveEditor, setReviewEditor };
