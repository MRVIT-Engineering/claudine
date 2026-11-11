import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import type { Effort } from "../backend";
import { accountOptions, ChatInput } from "../components/ChatInput";
import { AccountBadge, Empty } from "../components/Common";
import { previewImage } from "../components/ImagePreview";
import { MarkdownText } from "../components/MarkdownPreview";
import { Mascot } from "../components/Mascot";
import { ProposedDiff } from "../components/ProposedDiff";
import { Working } from "../components/Working";
import { drawThumbnail } from "../lib/images";
import { effortOptions } from "../lib/modes";
import { registerPermissionKeys } from "../lib/permissionKeys";
import {
  accountById,
  accounts,
  loadAccounts,
  startSignIn,
} from "../state/accounts";
import {
  answerPermission,
  autoStartClaude,
  autoStartPending,
  type ChatEntry,
  checkClaudeInstalled,
  claude,
  interruptClaude,
  MODES,
  type PermissionRequest,
  sendToClaude,
  setEffort,
  setMode,
  setModel,
  startClaude,
  stopClaude,
  switchAccount,
} from "../state/claude";
import { openFile, state } from "../state/store";
import { AccountPicker, SignInBox } from "./ClaudeAccounts";

/** Claude's Markdown, built as DOM nodes, never as HTML. */
function Prose(props: { text: string }) {
  return (
    <MarkdownText text={props.text} class="chat-text claude-prose md-chat" />
  );
}

const FILE_TOOLS = ["Read", "Write", "Edit", "NotebookEdit"];

function ToolEntry(props: { entry: Extract<ChatEntry, { kind: "tool" }> }) {
  const [expanded, setExpanded] = createSignal(false);
  const state = () => {
    const result = props.entry.result;
    if (!result) return "running";
    return result.isError ? "error" : "done";
  };
  const canOpen = () =>
    FILE_TOOLS.includes(props.entry.name) &&
    !props.entry.outside &&
    state() === "done";
  return (
    <div class="claude-tool" classList={{ [`is-${state()}`]: true }}>
      <button
        type="button"
        class="claude-tool-head"
        aria-expanded={expanded()}
        disabled={!props.entry.result?.text}
        onClick={() => setExpanded((open) => !open)}
      >
        <span class="dot" />
        <strong>{props.entry.name}</strong>
        <code class="truncate" title={props.entry.summary}>
          {props.entry.summary}
        </code>
        <Show when={props.entry.outside}>
          <span class="claude-outside">outside project</span>
        </Show>
      </button>
      <Show when={canOpen()}>
        <button
          type="button"
          class="claude-tool-open"
          onClick={() => openFile(props.entry.summary)}
        >
          Open
        </button>
      </Show>
      <Show when={expanded() && props.entry.result}>
        {(result) => <pre class="claude-tool-result">{result().text}</pre>}
      </Show>
    </div>
  );
}

/** One chat entry. `queued` marks a message Claude hasn't read yet. */
export function Entry(props: { entry: ChatEntry; queued?: boolean }) {
  // Entries are only appended, and a tool's `result` is read reactively inside ToolEntry.
  const entry = props.entry;
  switch (entry.kind) {
    case "user":
      return (
        <div
          class="chat-user claude-prose"
          classList={{ "is-queued": props.queued }}
        >
          <Show when={entry.images}>
            {(images) => (
              <span class="chat-images">
                <For each={images()}>
                  {(blob, index) => (
                    <button
                      type="button"
                      class="composer-image"
                      title="Preview"
                      aria-label={`Preview image ${index() + 1}`}
                      onClick={() => previewImage(blob)}
                    >
                      <canvas
                        width={96}
                        height={96}
                        ref={(canvas) => void drawThumbnail(canvas, blob)}
                      />
                    </button>
                  )}
                </For>
              </span>
            )}
          </Show>
          {entry.text}
          <Show when={props.queued}>
            <span class="queued-note">
              Queued: Claude reads it at its next step
            </span>
          </Show>
        </div>
      );
    case "text":
      return <Prose text={entry.text} />;
    case "tool":
      return <ToolEntry entry={entry} />;
    case "notice":
      return <div class={`claude-notice tone-${entry.tone}`}>{entry.text}</div>;
  }
}

/** An approval card. `onAnswer` defaults to the Editor session's. */
export function PermissionPrompt(props: {
  request: PermissionRequest;
  onAnswer?: (id: string, allow: boolean) => void;
}) {
  const reply = (allow: boolean) =>
    props.onAnswer
      ? props.onAnswer(props.request.id, allow)
      : void answerPermission(props.request.id, allow);
  onCleanup(registerPermissionKeys(reply));
  return (
    <div
      class="permission claude-permission"
      role="alertdialog"
      aria-label="Permission requested"
    >
      <strong>Claude wants to use {props.request.tool}</strong>
      <Show when={props.request.summary}>
        <code class="claude-permission-target">{props.request.summary}</code>
      </Show>
      <Show when={props.request.outside}>
        <span class="claude-warning">This is outside the open folder.</span>
      </Show>
      <Show
        when={props.request.proposal}
        fallback={
          <Show when={props.request.detail}>
            <pre class="claude-permission-detail">{props.request.detail}</pre>
          </Show>
        }
      >
        {(proposal) => (
          <div class="claude-permission-detail claude-permission-diff">
            <ProposedDiff proposal={proposal()} compact />
          </div>
        )}
      </Show>
      <div class="row">
        <button
          type="button"
          class="btn btn-sm"
          title="Deny (⇧N)"
          onClick={() => reply(false)}
        >
          Deny <kbd>⇧N</kbd>
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent"
          title="Allow (⇧↵)"
          onClick={() => reply(true)}
        >
          Allow <kbd>⇧↵</kbd>
        </button>
      </div>
    </div>
  );
}

function Composer() {
  const working = () => claude.status === "working";
  const modelTitle = () =>
    [
      claude.models.find((m) => m.value === claude.modelChoice)?.description,
      claude.model,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <ChatInput
      autofocus
      placeholder={working() ? "Queue another message…" : "Ask Claude…"}
      images
      onSend={sendToClaude}
      account={{
        value: accounts.selected,
        title: working()
          ? "Finish or stop this turn to switch accounts."
          : "Switching accounts starts a new conversation.",
        options: accountOptions(),
        onChange: (id) => {
          if (!working()) switchAccount(id);
        },
      }}
      onEscape={working() ? () => void interruptClaude() : undefined}
      onStop={working() ? () => void interruptClaude() : undefined}
      mode={{
        value: claude.mode,
        title: MODES.find((m) => m.value === claude.mode)?.hint,
        // `claude.mode` is a string, since Claude Code can report modes Claudine
        // doesn't offer; only the offered ones are in the list.
        options: MODES.map((m) => ({
          value: m.value,
          label: m.label,
          hint: m.hint,
        })),
        onChange: (value) => {
          const mode = MODES.find((m) => m.value === value);
          if (mode) void setMode(mode.value);
        },
      }}
      model={{
        value: claude.modelChoice,
        title: modelTitle(),
        options: claude.models.map((m) => ({
          value: m.value,
          label: m.name,
          hint: m.description,
        })),
        onChange: (model) => void setModel(model),
      }}
      effort={{
        value: claude.effort ?? "default",
        title: working()
          ? "Changing it waits until this turn ends."
          : "Changing it restarts Claude Code and keeps the conversation.",
        options: working()
          ? []
          : effortOptions(
              claude.models.find((m) => m.value === claude.modelChoice)
                ?.efforts ?? [],
            ),
        onChange: (value) =>
          void setEffort(value === "default" ? null : (value as Effort)),
      }}
    />
  );
}

function statusLabel(): string {
  switch (claude.status) {
    case "starting":
      return "Starting…";
    case "working":
      return "Working…";
    case "idle":
      return "Ready";
    case "ended":
      return "Ended";
    case "off":
      return "";
  }
}

function StartScreen() {
  const status = () => accounts.status[accounts.selected];
  // Only a definite "signed out" blocks starting; if the check failed, `claude` says why.
  const signedOut = () => {
    const s = status();
    return typeof s === "object" && !s.signedIn;
  };
  const signingIn = () => accounts.signIn?.account === accounts.selected;
  return (
    <Switch>
      <Match when={!state.project}>
        <Empty title="No folder open">
          Open a folder to start Claude Code in it.
        </Empty>
      </Match>
      <Match when={claude.found === false}>
        <Empty title="Claude Code isn't installed">
          Claudine uses your own Claude Code install and never downloads it.
          Install Claude Code, sign in once in a terminal, then try again.
          <button
            type="button"
            class="btn btn-sm"
            onClick={() => void checkClaudeInstalled()}
          >
            Check again
          </button>
        </Empty>
      </Match>
      <Match when={claude.status === "starting" || autoStartPending()}>
        <Empty title="Starting Claude Code…">
          With {accountById(accounts.selected)?.label ?? "your account"}. You
          can switch accounts in the chat input.
        </Empty>
      </Match>
      <Match when={true}>
        <div class="claude-start">
          <Mascot size={44} />
          <p>
            Claude Code runs in <strong>{state.project?.name}</strong> with the
            account you pick. You approve each edit and command here.
          </p>
          <AccountPicker />
          <Show
            when={signedOut()}
            fallback={
              <button
                type="button"
                class="btn btn-accent"
                disabled={claude.status === "starting"}
                onClick={() => void startClaude()}
              >
                {claude.status === "ended"
                  ? "Start a new session"
                  : "Start Claude"}
              </button>
            }
          >
            <button
              type="button"
              class="btn btn-accent"
              disabled={signingIn()}
              onClick={() => void startSignIn(accounts.selected)}
            >
              Sign in to start
            </button>
          </Show>
          <SignInBox account={accounts.selected} />
        </div>
      </Match>
    </Switch>
  );
}

export function ClaudePanel() {
  let scroller: HTMLDivElement | undefined;
  const live = () => claude.status === "idle" || claude.status === "working";

  onMount(() => {
    if (claude.found === null) void checkClaudeInstalled();
    if (!accounts.loaded) void loadAccounts();
  });
  // No start step: the session starts with the last used account once it's known.
  createEffect(autoStartClaude);

  createEffect(() => {
    claude.entries.length;
    claude.permissions.length;
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  return (
    <section class="chat claude-panel" aria-label="Claude">
      <div class="chat-tabs claude-head">
        <Mascot size={16} />
        <strong>Claude</strong>
        <Show when={live() && accountById(claude.account)}>
          {(account) => (
            <span class="claude-account-chip" title={account().label}>
              <AccountBadge
                label={account().label}
                color={account().color}
                size="sm"
              />
            </span>
          )}
        </Show>
        <Show when={claude.model}>
          <span class="muted truncate">{claude.model}</span>
        </Show>
        <span class="spacer" />
        <Show when={statusLabel()}>
          <span
            class="claude-status"
            classList={{ "is-working": claude.status === "working" }}
          >
            {statusLabel()}
          </span>
        </Show>
        <Show when={live()}>
          <button
            type="button"
            class="composer-btn"
            title="End this session and stop Claude Code"
            onClick={() => void stopClaude()}
          >
            End
          </button>
        </Show>
      </div>
      <div class="chat-scroll" ref={scroller}>
        <For each={claude.entries}>{(entry) => <Entry entry={entry} />}</For>
        <For each={claude.permissions}>
          {(request) => <PermissionPrompt request={request} />}
        </For>
        <Show
          when={claude.status === "working" && claude.permissions.length === 0}
        >
          <Working entries={claude.entries} />
        </Show>
        <Show when={!live()}>
          <StartScreen />
        </Show>
      </div>
      <Show when={live()}>
        <Composer />
      </Show>
    </section>
  );
}
