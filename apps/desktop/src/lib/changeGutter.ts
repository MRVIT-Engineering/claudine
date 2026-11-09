// Marks lines that differ from the file as it was opened, like VS Code's change bar:
// green for added, blue for changed, a red wedge where lines were removed.
import { Chunk } from "@codemirror/merge";
import {
  type Extension,
  type Range,
  RangeSet,
  StateField,
  Text,
} from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: "add" | "change" | "del") {
    super();
    this.elementClass = `cm-change-${kind}`;
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
}

const ADDED = new ChangeMarker("add");
const CHANGED = new ChangeMarker("change");
const DELETED = new ChangeMarker("del");

interface Changes {
  chunks: readonly Chunk[];
  markers: RangeSet<GutterMarker>;
}

function markersFor(chunks: readonly Chunk[], doc: Text): Changes {
  const ranges: Range<GutterMarker>[] = [];
  for (const chunk of chunks) {
    if (chunk.fromB === chunk.toB) {
      // Only removed lines: mark the line that now sits where they were.
      const at = doc.lineAt(Math.min(chunk.fromB, doc.length)).from;
      ranges.push(DELETED.range(at));
      continue;
    }
    const marker = chunk.fromA === chunk.toA ? ADDED : CHANGED;
    const first = doc.lineAt(chunk.fromB).number;
    const last = doc.lineAt(chunk.endB).number;
    for (let n = first; n <= last; n += 1) {
      ranges.push(marker.range(doc.line(n).from));
    }
  }
  return { chunks, markers: RangeSet.of(ranges, true) };
}

/** The change bar, measured against `original`: the file's text when it was opened. */
export function changeGutter(original: string): Extension {
  const base = Text.of(original.split(/\r\n?|\n/));
  const field = StateField.define<Changes>({
    create: (state) => markersFor(Chunk.build(base, state.doc), state.doc),
    update(value, tr) {
      if (!tr.docChanged) return value;
      const chunks = Chunk.updateB(value.chunks, base, tr.newDoc, tr.changes);
      return markersFor(chunks, tr.newDoc);
    },
  });
  return [
    field,
    gutter({
      class: "cm-change-gutter",
      markers: (view) => view.state.field(field).markers,
    }),
  ];
}
