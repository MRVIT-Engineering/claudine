// GitLens-style inline blame: rest the cursor on a line for a few seconds and the line's
// last commit shows at its end, in muted text. Rust runs a read-only `git blame` for it.
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type Blame, backend } from "../backend";

const DELAY_MS = 1000;

const showBlame = StateEffect.define<{ line: number; text: string }>();

class BlameText extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: BlameText) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-blame";
    span.textContent = this.text;
    return span;
  }
}

/** "3 days ago", from seconds since the epoch. */
export function timeAgo(seconds: number, now = Date.now()): string {
  const diff = Math.max(0, now / 1000 - seconds);
  const steps: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = diff;
  for (const [size, unit] of steps) {
    if (value < size) {
      const n = Math.floor(value);
      if (unit === "second") return "just now";
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
    value /= size;
  }
  return "";
}

export function blameText(blame: Blame): string {
  if (!blame.commit) return "You · Not committed yet";
  const who = blame.isYou ? "You" : blame.author;
  return `${who}, ${timeAgo(blame.time)} · ${blame.summary}`;
}

const blameField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(shown, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(showBlame)) continue;
      const { line, text } = effect.value;
      if (line > tr.state.doc.lines) return Decoration.none;
      const end = tr.state.doc.line(line).to;
      return Decoration.set([
        Decoration.widget({ widget: new BlameText(text), side: 1 }).range(end),
      ]);
    }
    // Moving or typing hides it until the cursor rests again.
    if (tr.docChanged || tr.selection) return Decoration.none;
    return shown;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Inline blame for `path`. `edited` says whether the buffer differs from the saved file. */
export function inlineBlame(path: string, edited: () => boolean): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer = 0;
      // Answers that arrive after the cursor moved are dropped.
      ticket = 0;
      constructor(readonly view: EditorView) {
        this.schedule();
      }
      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.focusChanged) {
          this.schedule();
        }
      }
      schedule() {
        window.clearTimeout(this.timer);
        this.ticket += 1;
        const { selection } = this.view.state;
        if (!this.view.hasFocus || selection.ranges.length > 1) return;
        if (!selection.main.empty) return;
        this.timer = window.setTimeout(() => void this.ask(), DELAY_MS);
      }
      async ask() {
        const ticket = this.ticket;
        const { state } = this.view;
        const line = state.doc.lineAt(state.selection.main.head).number;
        // An edited buffer is blamed as it is, so its line numbers match.
        const text = edited() ? state.doc.toString() : null;
        try {
          const blame = await backend.blameLine(path, line, text);
          if (!blame || ticket !== this.ticket) return;
          this.view.dispatch({
            effects: showBlame.of({ line, text: blameText(blame) }),
          });
        } catch {
          // Not a repository, or git isn't installed: nothing to show.
        }
      }
      destroy() {
        window.clearTimeout(this.timer);
      }
    },
  );
  return [blameField, plugin];
}
