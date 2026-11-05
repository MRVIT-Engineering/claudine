import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension, RangeSet, Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  gutterLineClass,
  lineNumbers,
  WidgetType,
} from "@codemirror/view";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
} from "solid-js";
import {
  createEditorRoot,
  languageFor,
  sharedExtensions,
} from "../lib/codemirror";
import type { Decision, Segment } from "../types";

export type HunkSegment = Extract<Segment, { kind: "hunk" }>;

// Room reserved in the code for a hunk bar, which is drawn on top across both panes.
const BAR_SPACE = 49;

class BarSpace extends WidgetType {
  override eq() {
    return true;
  }
  override get estimatedHeight() {
    return BAR_SPACE;
  }
  override toDOM() {
    const space = document.createElement("div");
    space.className = "cm-hunk-space";
    space.style.height = `${BAR_SPACE}px`;
    return space;
  }
}

class SignMarker extends GutterMarker {
  constructor(private readonly sign: string) {
    super();
  }
  override toDOM() {
    return document.createTextNode(this.sign);
  }
}

class ClassMarker extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}

interface ChangedRange {
  line: number;
  count: number;
  decided: boolean;
}

interface PlannedHunk {
  hunk: HunkSegment;
  index: number;
  total: number;
  aLine: number;
  bLine: number;
}

interface Plan {
  a: Text;
  b: Text;
  aChanges: ChangedRange[];
  bChanges: ChangedRange[];
  hunks: PlannedHunk[];
}

function buildPlan(
  segments: Segment[],
  decisionOf: (id: string) => Decision,
): Plan {
  const a: string[] = [];
  const b: string[] = [];
  const aChanges: ChangedRange[] = [];
  const bChanges: ChangedRange[] = [];
  const hunks: PlannedHunk[] = [];
  const total = segments.filter((s) => s.kind === "hunk").length;
  let index = 0;

  for (const segment of segments) {
    if (segment.kind === "context") {
      a.push(...segment.lines);
      b.push(...segment.lines);
      continue;
    }
    index += 1;
    if (segment.title) {
      hunks.push({
        hunk: segment,
        index,
        total,
        aLine: a.length + 1,
        bLine: b.length + 1,
      });
    }
    const decision = decisionOf(segment.id);
    const decided = decision === "accepted";
    if (decision === "rejected") {
      a.push(...segment.removed);
      b.push(...segment.removed);
      continue;
    }
    aChanges.push({
      line: a.length + 1,
      count: segment.removed.length,
      decided,
    });
    bChanges.push({ line: b.length + 1, count: segment.added.length, decided });
    a.push(...segment.removed);
    b.push(...segment.added);
  }
  return {
    a: Text.of(a.length > 0 ? a : [""]),
    b: Text.of(b.length > 0 ? b : [""]),
    aChanges,
    bChanges,
    hunks,
  };
}

// Line colors, +/- signs and the space for hunk bars on one side of the diff.
function sideExtension(
  doc: Text,
  changes: ChangedRange[],
  barLines: number[],
  kind: "del" | "add",
  barSide: number,
): Extension {
  const signs = new Map<number, SignMarker>();
  const lineClass = `cm-hunk-${kind}`;
  const decorations = [];
  const gutterClass = new ClassMarker(`cm-gutter-${kind}`);
  const gutterRanges = [];

  for (const change of changes) {
    for (let i = 0; i < change.count; i += 1) {
      const line = doc.line(change.line + i);
      const name = change.decided ? `${lineClass} cm-hunk-decided` : lineClass;
      decorations.push(Decoration.line({ class: name }).range(line.from));
      gutterRanges.push(gutterClass.range(line.from));
      signs.set(line.number, new SignMarker(kind === "del" ? "-" : "+"));
    }
  }
  for (const number of barLines) {
    const line = doc.line(Math.min(number, doc.lines));
    decorations.push(
      Decoration.widget({
        widget: new BarSpace(),
        block: true,
        side: barSide,
      }).range(line.from),
    );
  }
  const set: DecorationSet = Decoration.set(decorations, true);
  return [
    EditorView.decorations.of(set),
    gutterLineClass.of(RangeSet.of(gutterRanges, true)),
    lineNumbers(),
    gutter({
      class: "cm-sign-gutter",
      lineMarker(view, line) {
        return signs.get(view.state.doc.lineAt(line.from).number) ?? null;
      },
    }),
  ];
}

function readOnlyExtensions(path: string, wrap: boolean): Extension {
  return [
    sharedExtensions,
    languageFor(path),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    wrap ? EditorView.lineWrapping : [],
  ];
}

export function MergeReview(props: {
  path: string;
  segments: Segment[];
  layout: "side" | "inline";
  wrap: boolean;
  decisionOf: (id: string) => Decision;
  renderBar?: (hunk: HunkSegment, index: number, total: number) => JSX.Element;
}) {
  let wrapper!: HTMLDivElement;
  let host!: HTMLDivElement;
  let root: ShadowRoot | undefined;
  let destroy: (() => void) | undefined;
  let frame = 0;
  let measureBars = () => {};
  const plan = createMemo(() => buildPlan(props.segments, props.decisionOf));
  const [tops, setTops] = createSignal<number[]>([]);

  onMount(() => {
    root = createEditorRoot(host);

    createEffect(() => {
      const current = plan();
      const { layout, wrap, path } = props;
      destroy?.();
      if (!root) return;

      let barView: EditorView | undefined;
      const measure = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const view = barView;
          if (!view) return;
          const offset = view.documentTop - wrapper.getBoundingClientRect().top;
          setTops(
            current.hunks.map((planned) => {
              const number = Math.min(planned.bLine, view.state.doc.lines);
              const line = view.state.doc.line(number);
              return offset + view.lineBlockAt(line.from).top;
            }),
          );
        });
      };
      const remeasure = EditorView.updateListener.of((update) => {
        if (update.geometryChanged || update.viewportChanged) measure();
      });
      const shared = [readOnlyExtensions(path, wrap), remeasure];
      const aLines = current.hunks.map((h) => h.aLine);
      const bLines = current.hunks.map((h) => h.bLine);

      if (layout === "side") {
        const merge = new MergeView({
          a: {
            doc: current.a,
            extensions: [
              shared,
              sideExtension(current.a, current.aChanges, aLines, "del", -1),
            ],
          },
          b: {
            doc: current.b,
            extensions: [
              shared,
              sideExtension(current.b, current.bChanges, bLines, "add", -1),
            ],
          },
          parent: root,
          root,
          gutter: false,
          highlightChanges: false,
        });
        barView = merge.b;
        destroy = () => merge.destroy();
      } else {
        const view = new EditorView({
          state: EditorState.create({
            doc: current.b,
            extensions: [
              shared,
              unifiedMergeView({
                original: current.a,
                mergeControls: false,
                gutter: false,
                highlightChanges: false,
                syntaxHighlightDeletions: true,
              }),
              sideExtension(current.b, current.bChanges, bLines, "add", -2),
            ],
          }),
          parent: root,
          root,
        });
        barView = view;
        destroy = () => view.destroy();
      }
      measureBars = measure;
      measure();
    });

    const observer = new ResizeObserver(() => measureBars());
    observer.observe(wrapper);
    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => {
    cancelAnimationFrame(frame);
    destroy?.();
  });

  return (
    <div ref={wrapper} class="merge-wrapper">
      <div ref={host} class="cm-host" />
      <For each={plan().hunks}>
        {(planned, position) => (
          <div
            class="hunk-overlay"
            style={{ top: `${tops()[position()] ?? 0}px` }}
          >
            {props.renderBar?.(planned.hunk, planned.index, planned.total)}
          </div>
        )}
      </For>
    </div>
  );
}
