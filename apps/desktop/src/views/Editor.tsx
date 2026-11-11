import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { type DirEntry, describeError, hasBackend } from "../backend";
import { CodeEditor } from "../components/CodeEditor";
import { AccountChip, Empty } from "../components/Common";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { openFindInActive } from "../components/FindPanel";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CloseIcon,
  EyeIcon,
  FilesIcon,
  FolderIcon,
  FolderOpenIcon,
  GitIcon,
  PlusIcon,
  SearchIcon,
  SplitIcon,
  SunIcon,
} from "../components/Icons";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { Mascot } from "../components/Mascot";
import { MergeReview } from "../components/MergeReview";
import { ProposedDiff } from "../components/ProposedDiff";
import { Resizer } from "../components/Resizer";
import { PREVIEW_CLAUDE } from "../lib/flags";
import { registerPermissionKeys } from "../lib/permissionKeys";
import { dragging, dropTarget, startTabDrag } from "../lib/tabDrag";
import {
  answerPermission,
  claude,
  type PendingEdit,
  pendingEditOf,
  toggleClaudePanel,
} from "../state/claude";
import { closeGitDiff, type GitDiffView, git, treeChange } from "../state/git";
import type { Group, Layout, Split } from "../state/groups";
import {
  isMarkdown,
  isPreviewing,
  PREVIEW_KEYS,
  setMarkdownPreview,
} from "../state/markdown";
import {
  accountOf,
  activeFile,
  activeSession,
  approveEdit,
  CHAT_TAB,
  closeTab,
  composerFocus,
  DEFAULT_SETTINGS,
  decideAll,
  decideHunk,
  decisionOf,
  declineEdit,
  dirEntries,
  fileName,
  focusGroup,
  hunkCounts,
  letterOf,
  lineStats,
  navigate,
  openChatTab,
  openError,
  openFile,
  openProjectFolder,
  proposalFor,
  resolvedText,
  resolvePermission,
  revealInTree,
  selectSession,
  sendMessage,
  setDialog,
  setSessionMode,
  showSidebar,
  state,
  toggleFolder,
  treeReveals,
  updateSettings,
  WIDTHS,
} from "../state/store";
import type { Session, SourceFile, TranscriptItem } from "../types";
import { ClaudePanel } from "./ClaudePanel";
import { GitPanel } from "./GitPanel";
import { focusProjectSearch, SearchPanel } from "./SearchPanel";

function sessionForFile(path: string): Session | undefined {
  return state.sessions.find((s) => s.file === path);
}

/** The file shown in the editor area: a Git panel diff's, else the active tab's. */
function shownFile(): string | null {
  return git.diff?.proposal.path ?? (activeFile() || null);
}

function TreeItem(props: { entry: DirEntry; depth: number }) {
  const expanded = () => state.expanded.includes(props.entry.path);
  const active = () => !props.entry.isDir && shownFile() === props.entry.path;
  let row!: HTMLButtonElement;
  // The open file's row scrolls into view, also when its folder has just loaded.
  createEffect(() => {
    treeReveals();
    if (active()) row.scrollIntoView({ block: "nearest" });
  });
  const session = () => sessionForFile(props.entry.path);
  const account = () => {
    const s = session();
    return s ? accountOf(s.accountId) : undefined;
  };
  return (
    <li>
      <button
        ref={row}
        type="button"
        class={`tree-row depth-${Math.min(props.depth, 5)}`}
        classList={{
          active: active(),
          symlink: props.entry.isSymlink,
          "git-modified": treeChange(props.entry.path) === "modified",
          "git-added": treeChange(props.entry.path) === "added",
        }}
        title={props.entry.isSymlink ? "Symbolic link" : undefined}
        aria-expanded={props.entry.isDir ? expanded() : undefined}
        onClick={() => {
          if (props.entry.isDir) return toggleFolder(props.entry.path);
          // From the Agentic tab, a file opens in the Editor.
          if (state.view !== "editor") navigate("editor");
          return openFile(props.entry.path);
        }}
      >
        <Show
          when={props.entry.isDir}
          fallback={
            <>
              <span class="tree-chevron" />
              <span class="tree-file">
                <FileTypeIcon name={props.entry.name} size={14} />
              </span>
            </>
          }
        >
          <span class="tree-chevron">
            <Show when={expanded()} fallback={<ChevronRight size={12} />}>
              <ChevronDown size={12} />
            </Show>
          </span>
          <span class="tree-folder">
            <FolderIcon size={13} />
          </span>
        </Show>
        <span class="tree-name">{props.entry.name}</span>
        <Show when={account()}>
          {(a) => (
            <span class={`tree-letter acct-${a().color}`}>
              {letterOf(a().label)}
            </span>
          )}
        </Show>
      </button>
      <Show when={props.entry.isDir && expanded()}>
        <FileTree path={props.entry.path} depth={props.depth + 1} />
      </Show>
    </li>
  );
}

/** One folder's entries, loaded from Rust the first time it's shown. */
function FileTree(props: { path: string; depth: number }) {
  const listing = () => dirEntries(props.path);
  const entries = () => {
    const l = listing();
    return l?.status === "ready" ? l.value : undefined;
  };
  const failure = () => {
    const l = listing();
    return l?.status === "error" ? l.error : undefined;
  };
  const indent = () => `tree-status depth-${Math.min(props.depth, 5)}`;
  return (
    <Switch fallback={<p class={indent()}>Loading…</p>}>
      <Match when={failure()}>
        {(error) => <p class={`${indent()} error`}>{describeError(error())}</p>}
      </Match>
      <Match when={entries()}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={<p class={indent()}>Empty folder</p>}
          >
            <ul class="tree">
              <For each={list()}>
                {(entry) => <TreeItem entry={entry} depth={props.depth} />}
              </For>
            </ul>
          </Show>
        )}
      </Match>
    </Switch>
  );
}

/** The file tree. The Agentic tab shows it on the right. */
export function Explorer(props: { right?: boolean }) {
  // Opening a file, or a diff of one, opens its folders in the tree.
  createEffect(() => {
    const path = shownFile();
    // Untracked: reading the open folders here would reopen one the user collapses.
    if (path) untrack(() => revealInTree(path));
  });
  return (
    <aside
      class="sidebar explorer"
      classList={{ "explorer-right": props.right }}
    >
      <div class="sidebar-head">
        <h2 class="section-title">Explorer</h2>
        <Show when={state.project}>
          <button
            type="button"
            class="icon-btn"
            title="Open Folder… (⌘O)"
            aria-label="Open folder"
            onClick={() => void openProjectFolder()}
          >
            <FolderOpenIcon size={14} />
          </button>
        </Show>
      </div>
      <Show
        when={state.project}
        fallback={
          <div class="explorer-empty">
            <p class="muted">No folder open.</p>
            <button
              type="button"
              class="btn btn-accent"
              disabled={!hasBackend()}
              onClick={() => void openProjectFolder()}
            >
              Open Folder
            </button>
          </div>
        }
      >
        {(project) => (
          <>
            <p class="project-name" title={project().name}>
              {project().name}
            </p>
            <div class="explorer-scroll">
              <FileTree path="" depth={0} />
            </div>
          </>
        )}
      </Show>
      <Show when={PREVIEW_CLAUDE}>
        <p class="explorer-note">
          Letters show which account's session is touching a file.
        </p>
      </Show>
    </aside>
  );
}

/** Shown when no folder is open. */
function Welcome() {
  return (
    <div class="welcome">
      <Mascot size={88} class="hero-mascot" />
      <h1>Open a folder to start</h1>
      <p class="lede">
        Claudine shows the folder's files and lets you browse and edit them.
        Saving comes next.
      </p>
      <Show
        when={hasBackend()}
        fallback={
          <p class="welcome-error">{describeError({ kind: "unavailable" })}</p>
        }
      >
        <button
          type="button"
          class="btn btn-lg btn-accent"
          onClick={() => void openProjectFolder()}
        >
          Open Folder <kbd>⌘O</kbd>
        </button>
      </Show>
      <Show when={openError()}>
        {(error) => <p class="welcome-error">{describeError(error())}</p>}
      </Show>
    </div>
  );
}

/** A real file from disk: loading, a reason it can't be shown, or the editor. */
/** Claude's edit to this file, waiting for an answer. Answering here is the same as in the chat. */
function PendingEditView(props: { edit: PendingEdit }) {
  const name = () => fileName(props.edit.proposal.path);
  const creates = () =>
    props.edit.tool === "Write" && props.edit.proposal.before === "";
  onCleanup(
    registerPermissionKeys(
      (allow) => void answerPermission(props.edit.id, allow),
    ),
  );
  return (
    <>
      <div class="review-bar">
        <span class="review-title">
          Claude wants to {creates() ? "create" : "change"}{" "}
          <code>{name()}</code>
        </span>
        <button
          type="button"
          class="btn"
          title="Deny (⇧N)"
          onClick={() => void answerPermission(props.edit.id, false)}
        >
          Deny <kbd>⇧N</kbd>
        </button>
        <button
          type="button"
          class="btn btn-accent"
          title="Allow (⇧↵)"
          onClick={() => void answerPermission(props.edit.id, true)}
        >
          Allow <kbd>⇧↵</kbd>
        </button>
      </div>
      <div class="code-scroll">
        <ProposedDiff proposal={props.edit.proposal} />
      </div>
    </>
  );
}

function DiskFileView(props: { path: string }) {
  const loaded = () => state.files[props.path];
  const ready = () => {
    const file = loaded();
    return file?.status === "ready" ? { text: file.value } : undefined;
  };
  const failure = () => {
    const file = loaded();
    return file?.status === "error" ? file.error : undefined;
  };
  return (
    <Switch fallback={<Empty title="Loading…" />}>
      <Match when={failure()}>
        {(error) => (
          <Empty title={`Can't open ${fileName(props.path)}`}>
            {describeError(error())}
            <button
              type="button"
              class="btn btn-sm"
              onClick={() => openFile(props.path)}
            >
              Try again
            </button>
          </Empty>
        )}
      </Match>
      <Match when={ready()}>
        {(file) => (
          <Show
            when={isPreviewing(props.path)}
            fallback={<CodeEditor path={props.path} text={file().text} />}
          >
            <MarkdownPreview path={props.path} />
          </Show>
        )}
      </Match>
    </Switch>
  );
}

/** The Claude chat's tab, among the file tabs. */
function ChatTab(props: { group: Group; dropBefore: boolean }) {
  const active = () => props.group.active === CHAT_TAB;
  return (
    <div
      class="file-tab chat-tab"
      classList={{ active: active(), "drop-before": props.dropBefore }}
      data-tab={CHAT_TAB}
    >
      <button
        type="button"
        class="file-tab-open"
        role="tab"
        aria-selected={active()}
        onClick={openChatTab}
        onPointerDown={(e) => startTabDrag(CHAT_TAB, "Claude", e)}
      >
        <span class="file-tab-icon">
          <Mascot size={13} />
        </span>
        <span>Claude</span>
        <Show when={claude.status === "working"}>
          <span class="chat-tab-working" title="Claude is working" />
        </Show>
        <Show when={claude.permissions.length > 0}>
          <span class="count-badge" title="Waiting for your answer">
            {claude.permissions.length}
          </span>
        </Show>
      </button>
      <button
        type="button"
        class="file-tab-close"
        aria-label="Close Claude"
        title="Close. The session keeps running."
        onClick={() => closeTab(CHAT_TAB)}
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

/** Whether a dragged tab would land in this bar, before the tab at `index`. */
function dropsAt(groupId: string, index: number): boolean {
  const target = dropTarget();
  return (
    target?.kind === "bar" &&
    target.groupId === groupId &&
    target.index === index
  );
}

function Tabs(props: { group: Group }) {
  return (
    <div class="file-tabs-bar" data-tabbar={props.group.id}>
      <div
        class="file-tabs"
        role="tablist"
        aria-label="Open files"
        classList={{
          "drop-end": dropsAt(props.group.id, props.group.tabs.length),
        }}
      >
        <For each={props.group.tabs}>
          {(path, index) => {
            const dropBefore = () => dropsAt(props.group.id, index());
            if (path === CHAT_TAB)
              return <ChatTab group={props.group} dropBefore={dropBefore()} />;
            const stats = () => lineStats(path);
            const active = () => props.group.active === path;
            const proposed = () => active() && hunkCounts(path).pending > 0;
            return (
              <div
                class="file-tab"
                classList={{ active: active(), "drop-before": dropBefore() }}
                data-tab={path}
              >
                <button
                  type="button"
                  class="file-tab-open"
                  role="tab"
                  aria-selected={active()}
                  onClick={() => openFile(path)}
                  onDblClick={() => revealInTree(path, true)}
                  title="Double-click to show it in the file tree"
                  onPointerDown={(e) => startTabDrag(path, fileName(path), e)}
                >
                  <Show when={proposed()}>
                    <SplitIcon size={13} />
                  </Show>
                  <span class="file-tab-icon">
                    <FileTypeIcon name={path} size={13} />
                  </span>
                  <span>{fileName(path)}</span>
                  <Show when={state.dirty[path]}>
                    <span class="dirty-dot" title="Unsaved changes" />
                  </Show>
                  <Show when={proposed()}>
                    <span class="muted">(proposed)</span>
                    <span class="stat-add">+{stats().added}</span>
                    <Show when={stats().removed > 0}>
                      <span class="stat-del">−{stats().removed}</span>
                    </Show>
                  </Show>
                </button>
                <button
                  type="button"
                  class="file-tab-close"
                  aria-label={`Close ${fileName(path)}`}
                  onClick={() => closeTab(path)}
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            );
          }}
        </For>
      </div>
      <button
        type="button"
        class="tabs-find"
        title="Find in file"
        aria-label="Find in file"
        onClick={openFindInActive}
      >
        <SearchIcon size={13} />
        <kbd>⌘F</kbd>
      </button>
    </div>
  );
}

function Breadcrumb(props: { path: string }) {
  const parts = () => props.path.split("/");
  return (
    <nav class="breadcrumb" aria-label="File path">
      <For each={parts()}>
        {(part, index) => (
          <>
            <Show when={index() > 0}>
              <span class="breadcrumb-sep">›</span>
            </Show>
            <span
              classList={{ "breadcrumb-file": index() === parts().length - 1 }}
            >
              {part}
            </span>
          </>
        )}
      </For>
      <Show when={isMarkdown(props.path) && !proposalFor(props.path)}>
        <button
          type="button"
          class="icon-btn md-toggle"
          classList={{ on: isPreviewing(props.path) }}
          aria-pressed={isPreviewing(props.path)}
          aria-label="Markdown preview"
          title={`${isPreviewing(props.path) ? "Show the source" : "Show the rendered file"} (${PREVIEW_KEYS})`}
          onClick={() =>
            setMarkdownPreview(props.path, !isPreviewing(props.path))
          }
        >
          <EyeIcon size={15} />
        </button>
      </Show>
    </nav>
  );
}

/** A file's change from the Git panel, over the open tabs until closed. */
function GitDiff(props: { view: GitDiffView }) {
  return (
    <div class="git-diff">
      <div class="review-bar">
        <span class="review-title">
          <code>{props.view.proposal.path}</code> · {props.view.title}
        </span>
        <button type="button" class="btn" onClick={closeGitDiff}>
          Close
        </button>
      </div>
      <div class="code-scroll">
        <ProposedDiff proposal={props.view.proposal} />
      </div>
    </div>
  );
}

function ActivityBar() {
  return (
    <nav class="activity-bar" aria-label="Side bar">
      <button
        type="button"
        class="activity-btn"
        classList={{ active: state.sidebar === "explorer" }}
        title="Explorer (⇧⌘E)"
        aria-label="Explorer"
        aria-pressed={state.sidebar === "explorer"}
        onClick={() => showSidebar("explorer")}
      >
        <FilesIcon size={17} />
      </button>
      <button
        type="button"
        class="activity-btn"
        classList={{ active: state.sidebar === "search" }}
        title="Search (⇧⌘F)"
        aria-label="Search"
        aria-pressed={state.sidebar === "search"}
        onClick={() => {
          showSidebar("search");
          focusProjectSearch("");
        }}
      >
        <SearchIcon size={17} />
      </button>
      <Show when={!PREVIEW_CLAUDE}>
        <button
          type="button"
          class="activity-btn"
          classList={{ active: state.activeTab === CHAT_TAB }}
          title="Claude"
          aria-label="Claude"
          aria-pressed={state.activeTab === CHAT_TAB}
          onClick={toggleClaudePanel}
        >
          <Mascot size={18} />
        </button>
      </Show>
      <button
        type="button"
        class="activity-btn"
        classList={{ active: state.sidebar === "git" }}
        title="Git"
        aria-label="Git"
        aria-pressed={state.sidebar === "git"}
        onClick={() => showSidebar("git")}
      >
        <GitIcon size={17} />
      </button>
      <span class="spacer" />
      <button
        type="button"
        class="activity-btn"
        title="Toggle light and dark theme"
        aria-label="Toggle theme"
        onClick={() =>
          updateSettings({
            theme: state.settings.theme === "dark" ? "light" : "dark",
          })
        }
      >
        <SunIcon size={16} />
      </button>
    </nav>
  );
}

/** A proposed change under review, in the design preview. */
function ReviewView(props: { file: SourceFile }) {
  const path = () => props.file.path;
  const session = () => sessionForFile(path());
  const account = () => {
    const s = session();
    return s ? accountOf(s.accountId) : undefined;
  };
  const counts = () => hunkCounts(path());
  const canDecide = () => session()?.status !== "running";
  const reviewed = () => canDecide() && counts().pending === 0;
  const [editing, setEditing] = createSignal(false);

  return (
    <Show
      when={props.file.segments && !editing()}
      fallback={
        <>
          <Show when={props.file.segments}>
            <div class="review-bar">
              <span class="review-title">
                Editing the reviewed <code>{props.file.name}</code>
              </span>
              <button
                type="button"
                class="btn"
                onClick={() => setEditing(false)}
              >
                Show diff
              </button>
            </div>
          </Show>
          <CodeEditor path={path()} text={resolvedText(path())} />
        </>
      }
    >
      <div class="review-bar">
        <Show when={account()}>{(a) => <AccountChip account={a()} />}</Show>
        <span class="review-title">
          <Show
            when={canDecide()}
            fallback={
              <>
                Claude is still writing <code>{props.file.name}</code>
              </>
            }
          >
            <Show
              when={counts().pending > 0}
              fallback={
                <>
                  Reviewed <code>{props.file.name}</code>: {counts().accepted}{" "}
                  accepted, {counts().rejected} rejected
                </>
              }
            >
              Claude proposed {counts().total}{" "}
              {counts().total === 1 ? "change" : "changes"} to{" "}
              <code>{props.file.name}</code>
            </Show>
          </Show>
        </span>
        <Show when={reviewed()}>
          <button type="button" class="btn" onClick={() => setEditing(true)}>
            Edit file
          </button>
        </Show>
        <Show when={canDecide() && counts().pending > 0}>
          <button
            type="button"
            class="btn"
            onClick={() => decideAll(path(), "rejected")}
          >
            Reject all
          </button>
          <button
            type="button"
            class="btn btn-green-solid"
            onClick={() => decideAll(path(), "accepted")}
          >
            Accept all
          </button>
        </Show>
      </div>
      <div class="code-scroll">
        <Show
          when={state.settings.diffLayout === "side"}
          fallback={
            <div class="pane-heads single">
              <span>
                <strong>Inline</strong>{" "}
                <span class="muted">HEAD · {path()}</span>
              </span>
            </div>
          }
        >
          <div class="pane-heads">
            <span>
              <strong>Original</strong>{" "}
              <span class="muted">
                {props.file.isNew ? "New file" : `HEAD · ${path()}`}
              </span>
            </span>
            <span>
              <strong>Proposed</strong>{" "}
              <span class="muted">
                by {account()?.label ?? "Claude"}
                {counts().pending > 0 ? " · not applied yet" : " · reviewed"}
              </span>
            </span>
          </div>
        </Show>
        <MergeReview
          path={path()}
          segments={props.file.segments ?? []}
          layout={state.settings.diffLayout}
          wrap={state.settings.wrapLines}
          decisionOf={(id) => decisionOf(path(), id)}
          renderBar={(hunk, index, total) => {
            const decision = () => decisionOf(path(), hunk.id);
            return (
              <div class="hunk-bar">
                <span class="muted">
                  {index} of {total}
                </span>
                <span class="hunk-title">{hunk.title}</span>
                <Show when={canDecide()}>
                  <Show
                    when={decision() === "pending"}
                    fallback={
                      <>
                        <span
                          class={
                            decision() === "accepted" ? "stat-add" : "stat-del"
                          }
                        >
                          {decision() === "accepted" ? "Accepted" : "Rejected"}
                        </span>
                        <Show
                          when={!state.dirty[path()]}
                          fallback={<span class="muted">File edited</span>}
                        >
                          <button
                            type="button"
                            class="btn btn-sm"
                            onClick={() =>
                              decideHunk(path(), hunk.id, "pending")
                            }
                          >
                            Undo
                          </button>
                        </Show>
                      </>
                    }
                  >
                    <button
                      type="button"
                      class="btn btn-sm"
                      onClick={() => decideHunk(path(), hunk.id, "rejected")}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-green"
                      onClick={() => decideHunk(path(), hunk.id, "accepted")}
                    >
                      Accept
                    </button>
                  </Show>
                </Show>
              </div>
            );
          }}
        />
      </div>
    </Show>
  );
}

function ChatItem(props: { item: TranscriptItem; session: Session }) {
  const item = props.item;
  switch (item.kind) {
    case "user":
      return <div class="chat-user">{item.text}</div>;
    case "text":
      return (
        <p class="chat-text">
          {item.text
            .split("`")
            .map((part, i) => (i % 2 === 1 ? <code>{part}</code> : part))}
        </p>
      );
    case "think":
      return null;
    case "output":
      return <div class="chat-output">{item.text}</div>;
    case "status":
      return (
        <div class={`chat-status tone-${item.tone}`}>
          <Show when={item.tone === "running"}>
            <span class="cursor" />
          </Show>
          {item.text}
        </div>
      );
    case "tool": {
      if (item.verb === "edit" && item.target === props.session.file) {
        const stats = lineStats(item.target);
        return (
          <div class="edit-card">
            <div class="edit-card-head">
              <span class="dot dot-accent" />
              <strong>Edit</strong>
              <code class="truncate">{item.target}</code>
              <span class="spacer" />
              <span class="stat-add">+{stats.added}</span>
              <span class="stat-del">−{stats.removed}</span>
            </div>
            <button
              type="button"
              class="edit-card-link"
              onClick={() => openFile(item.target)}
            >
              <SplitIcon size={13} /> Open side-by-side diff
            </button>
          </div>
        );
      }
      return (
        <div class="chat-tool">
          <span class="dot dot-running" />
          <strong>{item.verb[0]?.toUpperCase() + item.verb.slice(1)}</strong>
          <code class="truncate">{item.target}</code>
          <Show when={item.detail}>
            <span class="muted truncate">{item.detail}</span>
          </Show>
        </div>
      );
    }
  }
}

function ApprovalCard(props: { session: Session }) {
  const file = () =>
    props.session.file ? fileName(props.session.file) : "this file";
  const options = [
    { key: "1", label: "Yes", run: () => approveEdit(props.session, false) },
    {
      key: "2",
      label: "Yes, allow edits for this session",
      run: () => approveEdit(props.session, true),
    },
    {
      key: "3",
      label: "No, tell Claude what to change",
      run: () => declineEdit(props.session),
    },
  ];

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".chat")) return;
    if (target.closest("input, textarea, select")) return;
    options.find((o) => o.key === event.key)?.run();
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div class="approval">
      <strong>
        Make this edit to <code>{file()}</code>?
      </strong>
      <For each={options}>
        {(option, index) => (
          <button
            type="button"
            class="approval-option"
            classList={{ primary: index() === 0 }}
            onClick={option.run}
          >
            <span>{option.key}</span> {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

export function PermissionCard(props: {
  command: string;
  onResolve: (outcome: "deny" | "once" | "always") => void;
}) {
  return (
    <div class="permission">
      <strong>Permission requested</strong>
      <code>{props.command}</code>
      <div class="row">
        <button
          type="button"
          class="btn btn-sm"
          onClick={() => props.onResolve("deny")}
        >
          Deny
        </button>
        <button
          type="button"
          class="btn btn-sm"
          onClick={() => props.onResolve("always")}
        >
          Always allow
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent"
          onClick={() => props.onResolve("once")}
        >
          Allow once
        </button>
      </div>
    </div>
  );
}

function Composer(props: { session: Session }) {
  const [text, setText] = createSignal("");
  let input!: HTMLTextAreaElement;
  const activeName = () => (activeFile() ? fileName(activeFile()) : undefined);

  createEffect(
    on(
      composerFocus,
      () => {
        input.focus();
      },
      { defer: true },
    ),
  );

  const submit = () => {
    if (!text().trim()) return;
    sendMessage(props.session.id, text());
    setText("");
  };

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={input}
        aria-label="Message"
        placeholder="Queue another message…"
        rows="2"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div class="composer-row">
        <Show when={activeName()}>
          <span class="file-chip">
            <FileTypeIcon name={activeName() ?? ""} size={12} /> {activeName()}
          </span>
        </Show>
        <button
          type="button"
          class="composer-btn"
          onClick={() =>
            setSessionMode(
              props.session.id,
              props.session.mode === "ask" ? "auto" : "ask",
            )
          }
        >
          {props.session.mode === "ask" ? "Ask before edits" : "Edits allowed"}
        </button>
        <button
          type="button"
          class="composer-btn"
          aria-label="Mention a file"
          onClick={() => {
            setText((t) => `${t}@`);
            input.focus();
          }}
        >
          @
        </button>
        <span class="spacer" />
        <button
          type="submit"
          class="send-btn"
          aria-label="Send"
          disabled={!text().trim()}
        >
          <ArrowUp />
        </button>
      </div>
    </form>
  );
}

function ChatPanel() {
  let scroller: HTMLDivElement | undefined;
  createEffect(() => {
    const session = activeSession();
    session?.transcript.length;
    session?.awaitingApproval;
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  return (
    <aside class="chat">
      <div class="chat-tabs" role="tablist" aria-label="Sessions">
        <For each={state.sessions}>
          {(session) => {
            const account = () => accountOf(session.accountId);
            return (
              <button
                type="button"
                role="tab"
                aria-selected={session.id === state.activeSessionId}
                class={`chat-tab acct-${account()?.color ?? "blue"}`}
                classList={{ active: session.id === state.activeSessionId }}
                onClick={() => selectSession(session.id)}
              >
                <b>{letterOf(account()?.label ?? "?")}</b>
                <span class="truncate">{account()?.label}</span>
              </button>
            );
          }}
        </For>
        <span class="spacer" />
        <button
          type="button"
          class="icon-btn"
          aria-label="New session"
          onClick={() => setDialog("new-session")}
        >
          <PlusIcon />
        </button>
      </div>
      <Show
        when={activeSession()}
        keyed
        fallback={
          <Empty title="No sessions yet">
            Start one to talk to Claude here.
          </Empty>
        }
      >
        {(session) => (
          <>
            <div class="chat-scroll" ref={scroller}>
              <For each={session.transcript}>
                {(item) => <ChatItem item={item} session={session} />}
              </For>
              <Show when={session.permission}>
                {(command) => (
                  <PermissionCardFor session={session} command={command()} />
                )}
              </Show>
              <Show when={session.awaitingApproval}>
                <ApprovalCard session={session} />
              </Show>
            </div>
            <Composer session={session} />
          </>
        )}
      </Show>
    </aside>
  );
}

function PermissionCardFor(props: { session: Session; command: string }) {
  return (
    <PermissionCard
      command={props.command}
      onResolve={(outcome) => resolvePermission(props.session, outcome)}
    />
  );
}

/** What one group shows: its tab's file, the chat, or a hint when it's empty. */
function GroupContent(props: { tab: string }) {
  return (
    <Show when={props.tab !== CHAT_TAB} fallback={<ClaudePanel />}>
      <Show
        when={props.tab}
        keyed
        fallback={
          <Empty title="No file open">
            Pick a file in the explorer, or press ⌘⇧O to go to a file.
          </Empty>
        }
      >
        {(path) => (
          <>
            <Breadcrumb path={path} />
            <Show
              when={proposalFor(path)}
              keyed
              fallback={
                <Show
                  when={pendingEditOf(path)}
                  keyed
                  fallback={<DiskFileView path={path} />}
                >
                  {(edit) => <PendingEditView edit={edit} />}
                </Show>
              }
            >
              {(proposal) => <ReviewView file={proposal} />}
            </Show>
          </>
        )}
      </Show>
    </Show>
  );
}

/** One tab group: its tab bar and what its shown tab holds. */
function EditorGroup(props: { group: Group }) {
  const zone = () => {
    const target = dropTarget();
    return target?.kind === "zone" && target.groupId === props.group.id
      ? target.zone
      : null;
  };
  return (
    <section
      class="editor-group"
      classList={{
        focused: state.activeGroup === props.group.id,
        split: state.layout.kind === "split",
      }}
      onPointerDown={() => focusGroup(props.group.id)}
      onFocusIn={() => focusGroup(props.group.id)}
    >
      <Tabs group={props.group} />
      <div class="editor-group-body" data-group-body={props.group.id}>
        <GroupContent tab={props.group.active} />
        <Show when={zone()}>
          {(side) => <div class={`drop-zone drop-${side()}`} />}
        </Show>
      </div>
    </section>
  );
}

/** The groups, split side by side or one above the other. */
function LayoutView(props: { node: Layout }) {
  return (
    <Switch>
      <Match when={props.node.kind === "split" && (props.node as Split)}>
        {(split) => (
          <div class={`editor-split split-${split().dir}`}>
            <LayoutView node={split().first} />
            <LayoutView node={split().second} />
          </div>
        )}
      </Match>
      <Match when={props.node.kind === "group" && (props.node as Group)}>
        {(group) => <EditorGroup group={group()} />}
      </Match>
    </Switch>
  );
}

/** The dragged tab's name, following the pointer. */
function DragLabel() {
  return (
    <Show when={dragging()}>
      {(drag) => (
        <div
          class="tab-drag-label"
          style={{
            transform: `translate(${drag().x + 12}px, ${drag().y + 10}px)`,
          }}
        >
          {drag().label}
        </div>
      )}
    </Show>
  );
}

export function Editor() {
  return (
    <div class="editor-layout" classList={{ "no-chat": !PREVIEW_CLAUDE }}>
      <ActivityBar />
      <div class="sidebar-slot">
        <Switch fallback={<Explorer />}>
          <Match when={state.sidebar === "search"}>
            <SearchPanel />
          </Match>
          <Match when={state.sidebar === "git"}>
            <GitPanel />
          </Match>
        </Switch>
        <Resizer
          label="Resize side bar"
          edge="right"
          value={state.settings.sidebarWidth}
          min={WIDTHS.sidebarWidth[0]}
          max={WIDTHS.sidebarWidth[1]}
          defaultValue={DEFAULT_SETTINGS.sidebarWidth}
          onChange={(sidebarWidth) => updateSettings({ sidebarWidth })}
        />
      </div>
      <main class="editor-main">
        <Show when={state.project} fallback={<Welcome />}>
          <Show
            when={git.diff}
            fallback={
              <>
                <div class="editor-groups">
                  <LayoutView node={state.layout} />
                </div>
                <DragLabel />
              </>
            }
          >
            {(diff) => <GitDiff view={diff()} />}
          </Show>
        </Show>
      </main>
      {/* The design preview keeps its mock chat on the right; the real one is a tab. */}
      <Show when={PREVIEW_CLAUDE}>
        <div class="sidebar-slot">
          <ChatPanel />
          <Resizer
            label="Resize chat"
            edge="left"
            value={state.settings.chatWidth}
            min={WIDTHS.chatWidth[0]}
            max={WIDTHS.chatWidth[1]}
            defaultValue={DEFAULT_SETTINGS.chatWidth}
            onChange={(chatWidth) => updateSettings({ chatWidth })}
          />
        </div>
      </Show>
    </div>
  );
}
