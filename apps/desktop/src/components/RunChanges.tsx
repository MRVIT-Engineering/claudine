// A run's changes, GitHub-style: a file list, then one card per file with Claude's
// explanation, the diff and line comments. Diffs come from Rust's `git diff`.
import {
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import type { DiffLine, FileDiff, Run, RunComment } from "../backend";
import { lineHighlighter } from "../lib/codemirror";
import {
  addComment,
  deleteComment,
  runs,
  setViewed,
  toggleSinceLast,
  viewedState,
} from "../state/runs";
import { state } from "../state/store";
import { FileTypeIcon } from "./FileTypeIcon";
import { ChevronDown, ChevronRight, PlusIcon } from "./Icons";

type Side = "new" | "old";

/** Where a comment on this line belongs: the new file, or the old one for a removed line. */
function anchor(line: DiffLine): { side: Side; line: number } | null {
  if (line.kind === "del")
    return line.old ? { side: "old", line: line.old } : null;
  return line.new ? { side: "new", line: line.new } : null;
}

function commentsAt(run: Run, path: string, side: Side, line: number) {
  return run.comments.filter(
    (c) => c.path === path && c.side === side && c.line === line,
  );
}

function CommentView(props: { run: Run; comment: RunComment }) {
  const label = () => {
    switch (props.comment.state) {
      case "pending":
        return "Pending";
      case "sent":
        return `Sent with revision ${props.comment.revision}`;
      case "resolved":
        return "Resolved";
    }
  };
  return (
    <div class={`review-comment is-${props.comment.state}`}>
      <div class="review-comment-head">
        <span class="review-comment-tag">{label()}</span>
        <Show when={props.comment.state === "pending"}>
          <button
            type="button"
            class="link-btn"
            onClick={() => void deleteComment(props.run.id, props.comment.id)}
          >
            Delete
          </button>
        </Show>
      </div>
      <p class="review-comment-body">{props.comment.body}</p>
      <Show when={props.comment.reply}>
        {(reply) => (
          <p class="review-comment-reply">
            <b>Claude:</b> {reply()}
          </p>
        )}
      </Show>
    </div>
  );
}

function CommentForm(props: {
  run: Run;
  path: string;
  side: Side;
  line: number;
  onClose: () => void;
}) {
  const [text, setText] = createSignal("");
  let input!: HTMLTextAreaElement;
  const save = async () => {
    if (!text().trim()) return;
    const ok = await addComment(
      props.run.id,
      props.path,
      props.line,
      props.side,
      text(),
    );
    if (ok) props.onClose();
  };
  return (
    <form
      class="review-comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        ref={(el) => {
          input = el;
          queueMicrotask(() => input.focus());
        }}
        class="input"
        rows="3"
        aria-label={`Comment on line ${props.line}`}
        placeholder="Leave a comment for Claude"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div class="row">
        <span class="muted small">
          Held as pending until you finish the review.
        </span>
        <span class="spacer" />
        <button type="button" class="btn btn-sm" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-sm btn-accent"
          disabled={!text().trim()}
        >
          Add comment
        </button>
      </div>
    </form>
  );
}

/** The comments under one line, and the form when it's open. */
function LineThread(props: {
  run: Run;
  path: string;
  at: { side: Side; line: number } | null;
  open: boolean;
  onClose: () => void;
  colspan: number;
}) {
  const list = () =>
    props.at
      ? commentsAt(props.run, props.path, props.at.side, props.at.line)
      : [];
  return (
    <Show when={props.at && (props.open || list().length > 0)}>
      <tr class="diff-thread">
        <td colspan={props.colspan}>
          <For each={list()}>
            {(comment) => <CommentView run={props.run} comment={comment} />}
          </For>
          <Show when={props.open && props.at}>
            {(at) => (
              <CommentForm
                run={props.run}
                path={props.path}
                side={at().side}
                line={at().line}
                onClose={props.onClose}
              />
            )}
          </Show>
        </td>
      </tr>
    </Show>
  );
}

function AddButton(props: { line: number; onClick: () => void }) {
  return (
    <button
      type="button"
      class="diff-add-comment"
      aria-label={`Comment on line ${props.line}`}
      title="Comment on this line"
      onClick={props.onClick}
    >
      <PlusIcon size={11} />
    </button>
  );
}

function Code(props: {
  text: string;
  paint: ((line: string) => JSX.Element) | null | undefined;
}) {
  return (
    <code class="diff-code">
      {props.paint ? props.paint(props.text) : props.text}
    </code>
  );
}

function UnifiedDiff(props: {
  run: Run;
  file: FileDiff;
  paint: ((line: string) => JSX.Element) | null | undefined;
}) {
  const [openAt, setOpenAt] = createSignal<string | null>(null);
  const key = (line: DiffLine) => {
    const at = anchor(line);
    return at ? `${at.side}:${at.line}` : "";
  };
  return (
    <table class="diff-table">
      <tbody>
        <Index each={props.file.hunks}>
          {(hunk) => (
            <>
              <tr class="diff-hunk">
                <td colspan="4">{hunk().header}</td>
              </tr>
              <Index each={hunk().lines}>
                {(line) => (
                  <>
                    <tr class={`diff-row is-${line().kind}`}>
                      <td class="diff-num">{line().old ?? ""}</td>
                      <td class="diff-num">
                        {line().new ?? ""}
                        <Show when={anchor(line())}>
                          {(at) => (
                            <AddButton
                              line={at().line}
                              onClick={() => setOpenAt(key(line()))}
                            />
                          )}
                        </Show>
                      </td>
                      <td class="diff-sign">
                        {line().kind === "add"
                          ? "+"
                          : line().kind === "del"
                            ? "−"
                            : ""}
                      </td>
                      <td>
                        <Code text={line().text} paint={props.paint} />
                      </td>
                    </tr>
                    <LineThread
                      run={props.run}
                      path={props.file.path}
                      at={anchor(line())}
                      open={openAt() === key(line())}
                      onClose={() => setOpenAt(null)}
                      colspan={4}
                    />
                  </>
                )}
              </Index>
            </>
          )}
        </Index>
      </tbody>
    </table>
  );
}

interface SideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pairs a hunk's lines into rows: context on both sides, removals next to additions. */
function sideRows(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i += 1) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    }
    dels = [];
    adds = [];
  };
  for (const line of lines) {
    if (line.kind === "del") dels.push(line);
    else if (line.kind === "add") adds.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

function SideDiff(props: {
  run: Run;
  file: FileDiff;
  paint: ((line: string) => JSX.Element) | null | undefined;
}) {
  const [openAt, setOpenAt] = createSignal<string | null>(null);
  const cell = (line: DiffLine | null, side: Side) => {
    if (!line) return <td class="diff-empty" colspan="2" />;
    const number = side === "old" ? line.old : line.new;
    const at = anchor(line);
    const commentable =
      at && (side === "new" ? line.kind !== "del" : line.kind === "del");
    return (
      <>
        <td class="diff-num">
          {number ?? ""}
          <Show when={commentable && at}>
            {(a) => (
              <AddButton
                line={a().line}
                onClick={() => setOpenAt(`${a().side}:${a().line}`)}
              />
            )}
          </Show>
        </td>
        <td class={`diff-cell is-${line.kind}`}>
          <Code text={line.text} paint={props.paint} />
        </td>
      </>
    );
  };
  // A comment thread goes under the row of the line it's on, on either side.
  const threadAt = (row: SideRow) =>
    (row.right && row.right.kind !== "del" ? anchor(row.right) : null) ??
    (row.left?.kind === "del" ? anchor(row.left) : null);
  return (
    <table class="diff-table diff-side">
      <tbody>
        <Index each={props.file.hunks}>
          {(hunk) => (
            <>
              <tr class="diff-hunk">
                <td colspan="4">{hunk().header}</td>
              </tr>
              <Index each={sideRows(hunk().lines)}>
                {(row) => {
                  const at = () => threadAt(row());
                  const key = () => (at() ? `${at()?.side}:${at()?.line}` : "");
                  // The left side's removed line can have its own thread.
                  const leftAt = () =>
                    row().left?.kind === "del" && row().right
                      ? anchor(row().left as DiffLine)
                      : null;
                  const leftKey = () =>
                    leftAt() ? `${leftAt()?.side}:${leftAt()?.line}` : "";
                  return (
                    <>
                      <tr class="diff-row">
                        {cell(row().left, "old")}
                        {cell(row().right, "new")}
                      </tr>
                      <LineThread
                        run={props.run}
                        path={props.file.path}
                        at={leftAt()}
                        open={openAt() === leftKey()}
                        onClose={() => setOpenAt(null)}
                        colspan={4}
                      />
                      <LineThread
                        run={props.run}
                        path={props.file.path}
                        at={at()}
                        open={openAt() === key()}
                        onClose={() => setOpenAt(null)}
                        colspan={4}
                      />
                    </>
                  );
                }}
              </Index>
            </>
          )}
        </Index>
      </tbody>
    </table>
  );
}

function FileCard(props: { run: Run; file: FileDiff; working: boolean }) {
  const viewed = () => viewedState(props.run, props.file);
  const [expanded, setExpanded] = createSignal<boolean | null>(null);
  // Viewed files fold up unless the user opens them again.
  const open = () => expanded() ?? viewed() !== "yes";
  const [paint] = createResource(() => props.file.path, lineHighlighter);
  const note = () =>
    props.run.explanation?.files.find((f) => f.path === props.file.path);
  const comments = () =>
    props.run.comments.filter((c) => c.path === props.file.path).length;
  return (
    <section
      class="file-card"
      id={`file-${props.file.path}`}
      aria-label={props.file.path}
    >
      <header class="file-card-head">
        <button
          type="button"
          class="icon-btn"
          aria-label={open() ? "Collapse" : "Expand"}
          aria-expanded={open()}
          onClick={() => setExpanded(!open())}
        >
          <Show when={open()} fallback={<ChevronRight size={13} />}>
            <ChevronDown size={13} />
          </Show>
        </button>
        <code class="file-card-path truncate" title={props.file.path}>
          <Show when={props.file.oldPath}>{(old) => <>{old()} → </>}</Show>
          {props.file.path}
        </code>
        <span class="stat-add">+{props.file.additions}</span>
        <span class="stat-del">−{props.file.deletions}</span>
        <Show when={props.file.status === "added"}>
          <span class="pill pill-green">New file</span>
        </Show>
        <Show when={props.file.status === "deleted"}>
          <span class="pill pill-red">Deleted</span>
        </Show>
        <Show when={viewed() === "changed"}>
          <span class="pill pill-amber">Changed since you viewed</span>
        </Show>
        <Show when={comments() > 0}>
          <span class="muted small">
            {comments()} {comments() === 1 ? "comment" : "comments"}
          </span>
        </Show>
        <span class="spacer" />
        <label class="viewed-box">
          <input
            type="checkbox"
            checked={viewed() === "yes"}
            onChange={(e) => {
              setExpanded(null);
              setViewed(props.run.id, props.file, e.currentTarget.checked);
            }}
          />
          Viewed
        </label>
      </header>
      <Show when={open()}>
        <Switch>
          <Match when={note()}>
            {(n) => (
              <div class="explain-box">
                <span class="explain-title">Claude's explanation</span>
                <p>{n().explanation}</p>
                <Show when={n().risk}>
                  {(risk) => (
                    <p class="explain-risk">
                      <b>Worth a look:</b> {risk()}
                    </p>
                  )}
                </Show>
              </div>
            )}
          </Match>
          <Match when={props.working}>
            <div class="explain-box is-placeholder">
              <span class="explain-title">Claude's explanation</span>
              <p>Claude explains each file when it finishes.</p>
            </div>
          </Match>
        </Switch>
        <Switch>
          <Match when={props.file.binary}>
            <p class="diff-note">Binary file, not shown.</p>
          </Match>
          <Match when={props.file.hunks.length === 0}>
            <p class="diff-note">
              {props.file.status === "renamed"
                ? "Renamed without changes."
                : "No text changes."}
            </p>
          </Match>
          <Match when={state.settings.diffLayout === "side"}>
            <SideDiff run={props.run} file={props.file} paint={paint()} />
          </Match>
          <Match when={true}>
            <UnifiedDiff run={props.run} file={props.file} paint={paint()} />
          </Match>
        </Switch>
        <Show when={props.file.truncated}>
          <p class="diff-note">This diff is long, so the rest isn't shown.</p>
        </Show>
      </Show>
    </section>
  );
}

export function RunChanges(props: { run: Run }) {
  const changes = () => runs.changes[props.run.id];
  const sinceLast = () =>
    runs.sinceLast[props.run.id] === true &&
    changes()?.data?.sinceLastReview != null;
  const files = createMemo<FileDiff[]>(() => {
    const data = changes()?.data;
    if (!data) return [];
    return sinceLast() ? (data.sinceLastReview ?? []) : data.files;
  });
  // Cards are keyed by path, so refreshes don't rebuild them or move the scroll.
  const paths = createMemo(() => files().map((f) => f.path), undefined, {
    equals: (a, b) => a.length === b.length && a.every((p, i) => p === b[i]),
  });
  const fileAt = (path: string) => files().find((f) => f.path === path);
  const working = () =>
    props.run.state === "running" ||
    props.run.state === "finishing" ||
    props.run.state === "paused";
  const viewedCount = () =>
    files().filter((f) => viewedState(props.run, f) === "yes").length;
  const commentCount = (path: string) =>
    props.run.comments.filter((c) => c.path === path).length;
  const jump = (path: string) =>
    document
      .getElementById(`file-${path}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <div class="run-changes">
      <Show when={working()}>
        <div class="banner banner-amber">
          Claude is still working. These changes may still move.
        </div>
      </Show>
      <Show when={changes()?.error}>
        {(error) => <div class="banner banner-red">{error()}</div>}
      </Show>
      <div class="run-changes-body">
        <aside class="changes-files" aria-label="Changed files">
          <div class="changes-progress">
            <span>
              {viewedCount()} of {files().length} files viewed
            </span>
            <progress max={Math.max(files().length, 1)} value={viewedCount()} />
          </div>
          <Show when={changes()?.data?.sinceLastReview}>
            <label class="since-toggle">
              <input
                type="checkbox"
                checked={sinceLast()}
                onChange={() => toggleSinceLast(props.run.id)}
              />
              Changes since last review
            </label>
          </Show>
          <ul>
            <For each={paths()}>
              {(path) => {
                const file = () => fileAt(path);
                const name = path.slice(path.lastIndexOf("/") + 1);
                return (
                  <li>
                    <button
                      type="button"
                      class="changes-file"
                      title={path}
                      onClick={() => jump(path)}
                    >
                      <FileTypeIcon name={name} size={13} />
                      <span class="truncate">{name}</span>
                      <Show when={commentCount(path) > 0}>
                        <span
                          class="comment-count"
                          title={`${commentCount(path)} comments`}
                        >
                          {commentCount(path)}
                        </span>
                      </Show>
                      <span class="spacer" />
                      <span class="stat-add">+{file()?.additions ?? 0}</span>
                      <span class="stat-del">−{file()?.deletions ?? 0}</span>
                      <Show
                        when={(() => {
                          const f = file();
                          return f && viewedState(props.run, f) === "yes";
                        })()}
                      >
                        <span class="viewed-check" title="Viewed">
                          ✓<span class="sr-only"> viewed</span>
                        </span>
                      </Show>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </aside>
        <div class="changes-cards">
          <Show
            when={paths().length > 0}
            fallback={
              <p class="muted changes-empty">
                {changes()?.loading && !changes()?.data
                  ? "Loading changes…"
                  : sinceLast()
                    ? "Nothing changed since the last review."
                    : "No changes yet."}
              </p>
            }
          >
            <For each={paths()}>
              {(path) => (
                <Show when={fileAt(path)}>
                  {(file) => (
                    <FileCard
                      run={props.run}
                      file={file()}
                      working={working()}
                    />
                  )}
                </Show>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
