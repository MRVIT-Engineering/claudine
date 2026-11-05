import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { CodeEditor } from "../components/CodeEditor";
import { AccountChip, Empty } from "../components/Common";
import { openFindInActive } from "../components/FindPanel";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CloseIcon,
  FileIcon,
  FilesIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SplitIcon,
  SunIcon,
} from "../components/Icons";
import { MergeReview } from "../components/MergeReview";
import { FILES, TREE } from "../mock/data";
import {
  accountOf,
  activeSession,
  approveEdit,
  closeTab,
  composerFocus,
  decideAll,
  decideHunk,
  decisionOf,
  declineEdit,
  hunkCounts,
  letterOf,
  lineStats,
  openFile,
  resolvedText,
  resolvePermission,
  selectSession,
  sendMessage,
  setDialog,
  setSessionMode,
  showSidebar,
  state,
  toggleFolder,
  updateSettings,
} from "../state/store";
import type { Session, SourceFile, TranscriptItem, TreeNode } from "../types";
import { focusProjectSearch, SearchPanel } from "./SearchPanel";

function sessionForFile(path: string): Session | undefined {
  return state.sessions.find((s) => s.file === path);
}

/** Folders first, then files, each alphabetically, as in VS Code. */
function sortedNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (!!a.children !== !!b.children) return a.children ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function FileTree(props: { nodes: TreeNode[]; depth: number }) {
  return (
    <ul class="tree">
      <For each={sortedNodes(props.nodes)}>
        {(node) => {
          const collapsed = () => state.collapsed.includes(node.path);
          const session = () => sessionForFile(node.path);
          const account = () => {
            const s = session();
            return s ? accountOf(s.accountId) : undefined;
          };
          return (
            <li>
              <button
                type="button"
                class={`tree-row depth-${Math.min(props.depth, 5)}`}
                classList={{
                  active: !node.children && state.activeTab === node.path,
                }}
                aria-expanded={node.children ? !collapsed() : undefined}
                onClick={() =>
                  node.children ? toggleFolder(node.path) : openFile(node.path)
                }
              >
                <Show
                  when={node.children}
                  fallback={
                    <>
                      <span class="tree-chevron" />
                      <span class="tree-file">
                        <FileIcon size={13} />
                      </span>
                    </>
                  }
                >
                  <span class="tree-chevron">
                    <Show
                      when={collapsed()}
                      fallback={<ChevronDown size={12} />}
                    >
                      <ChevronRight size={12} />
                    </Show>
                  </span>
                  <span class="tree-folder">
                    <FolderIcon size={13} />
                  </span>
                </Show>
                <span class="tree-name">{node.name}</span>
                <Show when={account()}>
                  {(a) => (
                    <span class={`tree-letter acct-${a().color}`}>
                      {letterOf(a().label)}
                    </span>
                  )}
                </Show>
              </button>
              <Show when={node.children && !collapsed()}>
                <FileTree nodes={node.children ?? []} depth={props.depth + 1} />
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

function Explorer() {
  return (
    <aside class="sidebar explorer">
      <h2 class="section-title">Explorer</h2>
      <div class="explorer-scroll">
        <FileTree nodes={TREE} depth={0} />
      </div>
      <p class="explorer-note">
        Letters show which account's session is touching a file.
      </p>
    </aside>
  );
}

function Tabs() {
  return (
    <div class="file-tabs-bar">
      <div class="file-tabs" role="tablist" aria-label="Open files">
        <For each={state.openTabs}>
          {(path) => {
            const file = FILES[path];
            const stats = () => lineStats(path);
            const proposed = () =>
              path === state.activeTab && hunkCounts(path).pending > 0;
            return (
              <div
                class="file-tab"
                classList={{ active: state.activeTab === path }}
              >
                <button
                  type="button"
                  class="file-tab-open"
                  role="tab"
                  aria-selected={state.activeTab === path}
                  onClick={() => openFile(path)}
                >
                  <Show when={proposed()}>
                    <SplitIcon size={13} />
                  </Show>
                  <span>{file?.name}</span>
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
                  aria-label={`Close ${file?.name}`}
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
    </nav>
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

function FileView(props: { file: SourceFile }) {
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
    props.session.file ? FILES[props.session.file]?.name : "this file";
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
  const activeName = () => FILES[state.activeTab]?.name;

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
            <FileIcon size={12} /> {activeName()}
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

export function Editor() {
  const file = () => FILES[state.activeTab];
  return (
    <div class="editor-layout">
      <ActivityBar />
      <Show when={state.sidebar === "search"} fallback={<Explorer />}>
        <SearchPanel />
      </Show>
      <main class="editor-main">
        <Tabs />
        <Show when={file()}>{(f) => <Breadcrumb path={f().path} />}</Show>
        <Show
          when={file()}
          keyed
          fallback={
            <Empty title="No file open">Pick a file in the explorer.</Empty>
          }
        >
          {(f) => <FileView file={f} />}
        </Show>
      </main>
      <ChatPanel />
    </div>
  );
}
