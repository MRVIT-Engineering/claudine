import { createSignal, For, Show } from "solid-js";
import { AccountBadge, Empty, STATUS_LABEL } from "../components/Common";
import { highlight } from "../lib/codemirror";
import { PROPOSALS } from "../mock/data";
import {
  accountOf,
  decideAll,
  hunkCounts,
  lineStats,
  navigate,
  openFile,
  resolvePermission,
  selectSession,
  sendMessage,
  setDialog,
  state,
} from "../state/store";
import type { Session, TranscriptItem } from "../types";
import { PermissionCard } from "./Editor";

function LogLine(props: { item: TranscriptItem }) {
  const item = props.item;
  switch (item.kind) {
    case "tool":
      return (
        <div class="log-line">
          <span class="log-verb">{item.verb}</span> <b>{item.target}</b>
          <Show when={item.detail}> · {item.detail}</Show>
        </div>
      );
    case "think":
      return (
        <div class="log-line">
          <span class="log-verb">think</span> {item.text}
        </div>
      );
    case "output":
      return <div class="log-line log-verb">{item.text}</div>;
    case "status":
      return (
        <div class={`log-line tone-${item.tone}`}>
          <Show when={item.tone === "running"}>
            <span class="cursor" />
          </Show>
          {item.text}
        </div>
      );
    case "user":
      return (
        <div class="log-line log-user">
          <span class="log-verb">you</span> {item.text}
        </div>
      );
    case "text":
      return item.chatOnly ? null : (
        <div class="log-line log-verb">{item.text}</div>
      );
  }
}

function SessionColumn(props: { session: Session }) {
  const account = () => accountOf(props.session.accountId);
  const [reply, setReply] = createSignal("");
  const file = () =>
    props.session.file ? PROPOSALS[props.session.file] : undefined;
  const pending = () =>
    props.session.file ? hunkCounts(props.session.file).pending : 0;

  const openInEditor = () => {
    selectSession(props.session.id);
    if (props.session.file) openFile(props.session.file);
    navigate("editor");
  };

  return (
    <section class={`column acct-${account()?.color ?? "blue"}`}>
      <header class="column-head">
        <div class="column-title">
          <AccountBadge
            label={account()?.label ?? "?"}
            color={account()?.color ?? "blue"}
          />
          <strong>{account()?.label}</strong>
          <span class="muted truncate">{account()?.email}</span>
          <span class="spacer" />
          <span class={`column-status status-${props.session.status}`}>
            <Show when={props.session.status === "running"}>
              <span class="dot dot-running" />
            </Show>
            {STATUS_LABEL[props.session.status]}
          </span>
        </div>
        <p class="column-task">{props.session.task}</p>
      </header>

      <Show when={file()}>
        {(f) => {
          const stats = () => lineStats(f().path);
          return (
            <div class="column-diff">
              <div class="column-diff-head">
                <code class="truncate">{f().path}</code>
                <span class="spacer" />
                <span class="stat-add">+{stats().added}</span>
                <Show
                  when={f().isNew}
                  fallback={<span class="stat-del">−{stats().removed}</span>}
                >
                  <span class="muted">new file</span>
                </Show>
              </div>
              <div class="mini-diff">
                <For each={f().preview ?? []}>
                  {(line) => (
                    <div class={`mini-line is-${line.type}`}>
                      <span class="sign">
                        {line.type === "del"
                          ? "-"
                          : line.type === "add"
                            ? "+"
                            : ""}
                      </span>
                      <span class="code">{highlight(line.text)}</span>
                    </div>
                  )}
                </For>
              </div>
              <Show when={props.session.status === "review"}>
                <div class="row column-actions">
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={openInEditor}
                  >
                    Open in editor
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-green"
                    onClick={() => decideAll(f().path, "accepted")}
                  >
                    Accept {pending()} {pending() === 1 ? "hunk" : "hunks"}
                  </button>
                </div>
              </Show>
            </div>
          );
        }}
      </Show>

      <div class="column-log">
        <For each={props.session.transcript.slice(1)}>
          {(item) => <LogLine item={item} />}
        </For>
        <Show when={props.session.permission}>
          {(command) => (
            <PermissionCard
              command={command()}
              onResolve={(outcome) => resolvePermission(props.session, outcome)}
            />
          )}
        </Show>
      </div>

      <form
        class="column-reply"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(props.session.id, reply());
          setReply("");
        }}
      >
        <label class="field">
          <span class="field-label">Reply to {account()?.label}</span>
          <input
            class="input"
            type="text"
            placeholder="Message this session…"
            value={reply()}
            onInput={(e) => setReply(e.currentTarget.value)}
          />
        </label>
      </form>
    </section>
  );
}

export function Parallel() {
  return (
    <Show
      when={state.sessions.length > 0}
      fallback={
        <div class="parallel-empty">
          <Empty title="No sessions running">
            <button
              type="button"
              class="btn btn-accent"
              onClick={() => setDialog("new-session")}
            >
              Add session
            </button>
          </Empty>
        </div>
      }
    >
      <div class="parallel">
        <For each={state.sessions}>
          {(session) => <SessionColumn session={session} />}
        </For>
      </div>
    </Show>
  );
}
