import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { createEffect, createResource, onCleanup, onMount } from "solid-js";
import type { Proposal } from "../backend";
import {
  createEditorRoot,
  loadLanguage,
  sharedExtensions,
} from "../lib/codemirror";

// The shared theme hides CodeMirror's own line colors for the hunk review; a proposal
// uses them. `&.cm-proposal` is more specific, so it wins.
const proposalTheme = EditorView.theme({
  "&.cm-proposal .cm-changedLine": {
    backgroundColor: "var(--add-bg) !important",
  },
});

/**
 * Claude's proposed change as a read-only diff: the new text, with removed lines shown
 * in red above the lines that replace them. `compact` is the chat card: unchanged code is
 * folded away and long lines wrap.
 */
export function ProposedDiff(props: { proposal: Proposal; compact?: boolean }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const [language] = createResource(() => props.proposal.path, loadLanguage);

  onMount(() => {
    const root = createEditorRoot(host);

    createEffect(() => {
      const { before, after } = props.proposal;
      // Builds again once the language arrives, which adds the colors.
      const extensions = [
        sharedExtensions,
        proposalTheme,
        language() ?? [],
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.editorAttributes.of({ class: "cm-review cm-proposal" }),
        props.compact ? EditorView.lineWrapping : lineNumbers(),
        unifiedMergeView({
          original: before,
          mergeControls: false,
          highlightChanges: false,
          syntaxHighlightDeletions: true,
          collapseUnchanged: props.compact
            ? { margin: 2, minSize: 4 }
            : { margin: 4, minSize: 8 },
        }),
      ];
      view?.destroy();
      view = new EditorView({
        state: EditorState.create({ doc: after, extensions }),
        parent: root,
        root,
      });
    });
  });

  onCleanup(() => view?.destroy());

  return (
    <div
      ref={host}
      class="cm-host proposed-diff"
      classList={{ "is-compact": props.compact }}
    />
  );
}
