// Agentic mode: runs where Claude Code works on its own on a branch and worktree, then a
// pre-PR review. Everything here is shown from Rust's run state; every action is a run id
// and a choice, checked again in apps/desktop/src-tauri/src/runs.rs.
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import {
  DEFAULT_ACCOUNT,
  type Effort,
  type ModelOption,
  type Run,
  type RunPermissions,
} from "../backend";
import { ChatInput } from "../components/ChatInput";
import { AccountBadge } from "../components/Common";
import { CheckIcon, ChevronDown, PlusIcon } from "../components/Icons";
import { Resizer } from "../components/Resizer";
import { RunChanges } from "../components/RunChanges";
import { Working } from "../components/Working";
import {
  effortOptions,
  MODEL_ALIASES,
  modelOptions,
  RUN_MODES,
} from "../lib/modes";
import { accountById, accounts, loadAccounts } from "../state/accounts";
import { claude } from "../state/claude";
import {
  answerRunPermission,
  approveRun,
  cancelNewRun,
  createRun,
  discardRun,
  dismissRunsError,
  loadModels,
  loadRuns,
  openRun,
  openRunInEditor,
  overlapsFor,
  refreshChanges,
  requestChanges,
  resumeRun,
  reviewRunNow,
  runningCount,
  runs,
  selectedRun,
  sendRunMessage,
  setRunOptions,
  setTab,
  startNewRun,
  stopRun,
  tabOf,
  toReviewCount,
} from "../state/runs";
import {
  DEFAULT_SETTINGS,
  loadCurrentProject,
  navigate,
  openProjectFolder,
  state,
  updateSettings,
  WIDTHS,
} from "../state/store";
import { Entry, PermissionPrompt } from "./ClaudePanel";
import { Explorer } from "./Editor";

const STATE_LABEL: Record<Run["state"], string> = {
  running: "Running",
  finishing: "Finishing",
  review: "Ready for review",
  approved: "Approved",
  applied: "Applied",
  paused: "Paused",
  interrupted: "Interrupted",
};

function statusPill(run: Run): { text: string; tone: string } {
  if (run.state === "approved") {
    return run.prNumber
      ? { text: `PR #${run.prNumber} opened`, tone: "green" }
      : { text: "Committed", tone: "green" };
  }
  if (run.state === "running" && run.permissions.length > 0) {
    return { text: "Waiting for you", tone: "amber" };
  }
  const tone: Record<Run["state"], string> = {
    running: "accent",
    finishing: "accent",
    review: "blue",
    approved: "green",
    applied: "green",
    paused: "amber",
    interrupted: "red",
  };
  return {
    text: run.state === "review" ? "Ready for review" : STATE_LABEL[run.state],
    tone: tone[run.state],
  };
}

function accountOf(run: Run) {
  return (
    accountById(run.account) ?? {
      id: run.account,
      label: run.account === DEFAULT_ACCOUNT ? "Default" : "Removed account",
      color: "violet" as const,
    }
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function stepText(run: Run): string | null {
  if (run.plan.length === 0) return null;
  const done = run.plan.filter((p) => p.status === "completed").length;
  const current = Math.min(done + 1, run.plan.length);
  return `Step ${current} of ${run.plan.length}`;
}

function RunItem(props: { run: Run }) {
  const pill = () => statusPill(props.run);
  const account = () => accountOf(props.run);
  const working = () =>
    props.run.state === "running" || props.run.state === "finishing";
  const done = () =>
    props.run.plan.filter((p) => p.status === "completed").length;
  return (
    <li>
      <button
        type="button"
        class="run-item"
        classList={{ active: runs.selected === props.run.id && !runs.creating }}
        onClick={() => void openRun(props.run.id)}
      >
        <AccountBadge
          label={account().label}
          color={account().color}
          size="sm"
        />
        <span class="run-item-body">
          <span class="run-item-title">{props.run.title}</span>
          <span class="run-item-meta">
            <span class={`pill pill-${pill().tone}`}>{pill().text}</span>
            <Show
              when={working() && stepText(props.run)}
              fallback={
                <Show when={props.run.stats.files > 0}>
                  <span class="muted">
                    {plural(props.run.stats.files, "file")} · +
                    {props.run.stats.additions} −{props.run.stats.deletions}
                  </span>
                </Show>
              }
            >
              {(text) => <span class="muted">{text()}</span>}
            </Show>
          </span>
          <Show when={working() && props.run.plan.length > 0}>
            <progress
              class="run-progress"
              max={props.run.plan.length}
              value={done()}
            />
          </Show>
          <Show when={overlapsFor(props.run).length > 0}>
            <span class="run-item-warn">Touches files another run changes</span>
          </Show>
        </span>
      </button>
    </li>
  );
}

function RunsList() {
  return (
    <aside class="runs-list" aria-label="Runs">
      <header class="runs-head">
        <span class="section-title">Runs</span>
        <span class="muted small">
          {runningCount()} running · {toReviewCount()} to review
        </span>
      </header>
      <Show when={!state.settings.prePrReview}>
        <div class="banner banner-amber runs-notice">
          Pre-PR review is off. Finished runs commit straight to their branch.
          <button
            type="button"
            class="btn btn-sm"
            onClick={() => updateSettings({ prePrReview: true })}
          >
            Turn on
          </button>
        </div>
      </Show>
      <ul>
        <For each={runs.list}>{(run) => <RunItem run={run} />}</For>
      </ul>
      <Show when={runs.list.length === 0}>
        <p class="muted small runs-empty">No runs yet.</p>
      </Show>
    </aside>
  );
}

/** The modes a run can use, noting when this Claude Code has no auto mode. */
function runModeOptions() {
  const noAuto = runs.newRun?.autoAvailable === false;
  return RUN_MODES.map((m) => ({
    value: m.value as string,
    label: m.label,
    hint:
      m.value === "auto" && noAuto
        ? "This Claude Code has no auto mode, so edits and safe commands go through."
        : m.hint,
  }));
}

/** The account's models as `claude` lists them, else the Editor chat's, else aliases. */
function modelsFor(account: string): ModelOption[] {
  const listed = runs.models[account];
  if (listed && listed.length > 0) return listed;
  if (claude.models.length > 0 && claude.account === account)
    return claude.models;
  return MODEL_ALIASES;
}

/** The effort choices for a model. */
function effortsFor(account: string, model: string) {
  return effortOptions(
    modelsFor(account).find((m) => m.value === model)?.efforts ?? [],
  );
}

/** Just the task, mode and model. The run uses the selected account and the current branch. */
function NewRunForm() {
  const [mode, setMode] = createSignal<string>(state.settings.runPermissions);
  const [model, setModel] = createSignal("default");
  const [effort, setEffort] = createSignal("default");
  const account = () => accounts.selected || DEFAULT_ACCOUNT;
  createEffect(() => void loadModels(account()));
  const base = () => {
    const info = runs.newRun;
    return info ? (info.currentBranch ?? info.branches[0] ?? "") : "";
  };
  const start = (task: string) =>
    createRun(account(), task, base(), {
      mode: mode() as RunPermissions,
      model: model() === "default" ? undefined : model(),
      effort: effort() === "default" ? undefined : (effort() as Effort),
    });
  return (
    <div class="new-run">
      <h2>New run</h2>
      <p class="muted">
        Claude works on its own on a new branch. You can watch, steer it with
        messages, and review every change before anything is committed.
      </p>
      <ChatInput
        autofocus
        label="Task"
        rows={4}
        placeholder={
          state.project
            ? "What should Claude do? Be as specific as you'd be in a ticket."
            : "Open a folder to start a run."
        }
        sendLabel={runs.busy.new ? "Starting…" : "Start run"}
        disabled={!state.project}
        canSend={base() !== "" && !runs.busy.new}
        onSend={start}
        onEscape={runs.list.length > 0 ? cancelNewRun : undefined}
        mode={{ value: mode(), options: runModeOptions(), onChange: setMode }}
        model={{
          value: model(),
          options: modelOptions(modelsFor(account())),
          onChange: setModel,
        }}
        effort={{
          value: effort(),
          options: effortsFor(account(), model()),
          onChange: setEffort,
        }}
      />
      <Show when={!state.project}>
        <p class="muted small new-run-folder">
          Runs work on branches of a git repository.{" "}
          <button
            type="button"
            class="btn btn-sm btn-accent"
            onClick={() => void openProjectFolder()}
          >
            Open Folder…
          </button>
        </p>
      </Show>
    </div>
  );
}

function Elapsed(props: { run: Run }) {
  const [tick, setTick] = createSignal(Date.now());
  const timer = window.setInterval(() => setTick(Date.now()), 1000);
  onCleanup(() => window.clearInterval(timer));
  const text = () => {
    const end = props.run.finishedAt ?? tick();
    const seconds = Math.max(0, Math.floor((end - props.run.startedAt) / 1000));
    const m = Math.floor(seconds / 60);
    return m > 0 ? `${m}m ${seconds % 60}s` : `${seconds}s`;
  };
  return <span class="muted">{text()}</span>;
}

function PlanCard(props: { run: Run }) {
  const done = () =>
    props.run.plan.filter((p) => p.status === "completed").length;
  return (
    <Show when={props.run.plan.length > 0}>
      <section class="plan-card" aria-label="Plan">
        <header>
          <strong>Plan</strong>
          <span class="muted">
            {done()} of {props.run.plan.length} done
          </span>
        </header>
        <ul>
          <For each={props.run.plan}>
            {(item) => (
              <li class={`plan-item is-${item.status}`}>
                <span class="plan-mark" aria-hidden="true">
                  <Switch fallback={<span class="plan-dot" />}>
                    <Match when={item.status === "completed"}>
                      <CheckIcon size={13} />
                    </Match>
                    <Match when={item.status === "in_progress"}>
                      <span class="plan-spin" />
                    </Match>
                  </Switch>
                </span>
                {item.text}
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function RunComposer(props: { run: Run }) {
  const account = () => accountOf(props.run);
  createEffect(() => void loadModels(props.run.account));
  const hint = () => {
    switch (props.run.state) {
      case "running":
      case "paused":
        return "Claude reads this at its next step";
      case "review":
        return "Sending starts a new revision";
      case "interrupted":
        return "Sending resumes the run";
      default:
        return "";
    }
  };
  const closed = () =>
    props.run.state === "approved" || props.run.state === "applied";
  return (
    <div class="run-composer">
      <ChatInput
        disabled={
          !["running", "paused", "review", "interrupted"].includes(
            props.run.state,
          )
        }
        placeholder={
          props.run.state === "review"
            ? "Ask a question or ask for more changes…"
            : "Steer Claude while it works…"
        }
        onSend={(text) => sendRunMessage(props.run.id, text)}
        mode={
          closed()
            ? undefined
            : {
                value: props.run.mode ?? state.settings.runPermissions,
                options: runModeOptions(),
                onChange: (mode) =>
                  void setRunOptions(props.run.id, {
                    mode: mode as RunPermissions,
                  }),
              }
        }
        model={
          closed()
            ? undefined
            : {
                value: props.run.model ?? "default",
                options: modelOptions(modelsFor(props.run.account)),
                onChange: (model) =>
                  void setRunOptions(props.run.id, { model }),
              }
        }
        effort={
          closed()
            ? undefined
            : {
                value: props.run.effort ?? "default",
                title: "Applies the next time Claude starts in this run.",
                options: effortsFor(
                  props.run.account,
                  props.run.model ?? "default",
                ),
                onChange: (effort) => {
                  if (effort !== "default") {
                    void setRunOptions(props.run.id, {
                      effort: effort as Effort,
                    });
                  }
                },
              }
        }
      >
        <span class={`account-chip acct-${account().color}`}>
          <b>{account().label.charAt(0).toUpperCase()}</b> {account().label}
        </span>
        <span class="muted small">{hint()}</span>
      </ChatInput>
    </div>
  );
}

function Conversation(props: { run: Run }) {
  let scroller!: HTMLDivElement;
  const entries = () => runs.transcripts[props.run.id] ?? [];
  // The last `queued` messages the user sent are ones Claude hasn't read yet.
  const queuedFrom = createMemo(() => {
    const users = entries()
      .map((entry, i) => (entry.kind === "user" ? i : -1))
      .filter((i) => i >= 0);
    return props.run.queued > 0
      ? (users[users.length - props.run.queued] ?? Infinity)
      : Infinity;
  });
  const working = () =>
    (props.run.state === "running" || props.run.state === "finishing") &&
    props.run.live &&
    props.run.permissions.length === 0;
  // Follows new messages while the user is near the bottom.
  createEffect(
    on(
      () => [entries().length, props.run.permissions.length, working()],
      () => {
        const near =
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
          160;
        if (near)
          queueMicrotask(() => (scroller.scrollTop = scroller.scrollHeight));
      },
    ),
  );
  return (
    <div class="run-conversation">
      <div class="run-scroll" ref={scroller}>
        <PlanCard run={props.run} />
        <div class="run-entries">
          <For each={entries()}>
            {(entry, i) => (
              <Entry
                entry={entry}
                queued={entry.kind === "user" && i() >= queuedFrom()}
              />
            )}
          </For>
          <For each={props.run.permissions}>
            {(request) => (
              <PermissionPrompt
                request={request}
                onAnswer={(id, allow) =>
                  void answerRunPermission(props.run.id, id, allow)
                }
              />
            )}
          </For>
          <Show when={working()}>
            <Working entries={entries()} />
          </Show>
        </div>
      </div>
      <RunComposer run={props.run} />
    </div>
  );
}

function FinishReview(props: { run: Run; onClose: () => void }) {
  type Choice = "approve" | "commit" | "changes";
  const [choice, setChoice] = createSignal<Choice>("approve");
  const [note, setNote] = createSignal("");
  const pending = () =>
    props.run.comments.filter((c) => c.state === "pending").length;
  const opensPr = () => state.settings.onApprove === "pr";
  const canSubmit = () =>
    choice() !== "changes" || pending() > 0 || note().trim().length > 0;
  const submit = async () => {
    if (!canSubmit()) return;
    const ok =
      choice() === "changes"
        ? await requestChanges(props.run.id, note())
        : await approveRun(props.run.id, choice() === "commit" || !opensPr());
    if (ok) props.onClose();
  };
  let root!: HTMLDivElement;
  const onOutside = (event: PointerEvent) => {
    if (!event.composedPath().includes(root)) props.onClose();
  };
  onMount(() => document.addEventListener("pointerdown", onOutside, true));
  onCleanup(() => document.removeEventListener("pointerdown", onOutside, true));
  return (
    <div
      ref={root}
      class="finish-popover"
      role="dialog"
      aria-label="Finish review"
      onKeyDown={(e) => e.key === "Escape" && props.onClose()}
    >
      <strong>Finish your review</strong>
      <textarea
        class="input"
        rows="4"
        placeholder="Leave an overall note (optional)"
        value={note()}
        onInput={(e) => setNote(e.currentTarget.value)}
      />
      <label class="finish-choice">
        <input
          type="radio"
          name="finish"
          checked={choice() === "approve"}
          onChange={() => setChoice("approve")}
        />
        <span>
          <b>{opensPr() ? "Approve and open PR" : "Approve and commit"}</b>
          <span class="muted small">
            {opensPr()
              ? `Commit, push ${props.run.branch} and open a pull request with gh.`
              : `Commit to ${props.run.branch}. Nothing is pushed.`}
          </span>
        </span>
      </label>
      <Show when={opensPr()}>
        <label class="finish-choice">
          <input
            type="radio"
            name="finish"
            checked={choice() === "commit"}
            onChange={() => setChoice("commit")}
          />
          <span>
            <b>Approve and commit only</b>
            <span class="muted small">
              Commit to the branch without pushing.
            </span>
          </span>
        </label>
      </Show>
      <label class="finish-choice">
        <input
          type="radio"
          name="finish"
          checked={choice() === "changes"}
          onChange={() => setChoice("changes")}
        />
        <span>
          <b>Request changes</b>
          <span class="muted small">
            Sends {plural(pending(), "pending comment")}
            {note().trim() ? " and your note" : ""} to Claude for revision{" "}
            {props.run.revision + 1}.
          </span>
        </span>
      </label>
      <div class="row">
        <button
          type="button"
          class="btn-link danger"
          onClick={() => {
            props.onClose();
            void discardRun(props.run.id);
          }}
        >
          Discard run…
        </button>
        <span class="spacer" />
        <button type="button" class="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-accent"
          disabled={!canSubmit() || runs.busy[props.run.id]}
          onClick={() => void submit()}
        >
          Submit review
        </button>
      </div>
      <Show when={choice() === "changes" && !canSubmit()}>
        <span class="muted small">
          Add a line comment or a note to request changes.
        </span>
      </Show>
    </div>
  );
}

function RunHeader(props: { run: Run }) {
  const [finishing, setFinishing] = createSignal(false);
  const account = () => accountOf(props.run);
  const pill = () => statusPill(props.run);
  const pending = () =>
    props.run.comments.filter((c) => c.state === "pending").length;
  const isReview = () => props.run.state === "review";
  const title = () => props.run.explanation?.title ?? props.run.title;
  const openEditor = async () => {
    if (await openRunInEditor(props.run.id)) {
      await loadCurrentProject();
      navigate("editor");
    }
  };
  return (
    <header class="run-header">
      <div class="run-header-top">
        <div class="run-header-pills">
          <span class={`pill pill-${pill().tone}`}>
            {isReview() ? "Ready for pre-PR review" : pill().text}
          </span>
          <span class="pill">Revision {props.run.revision}</span>
          <Elapsed run={props.run} />
        </div>
        <div class="run-header-actions">
          <Switch>
            <Match
              when={
                props.run.state === "running" || props.run.state === "paused"
              }
            >
              <button
                type="button"
                class="btn"
                disabled={runs.busy[props.run.id]}
                onClick={() => void stopRun(props.run.id)}
              >
                Stop
              </button>
            </Match>
            <Match when={props.run.state === "interrupted"}>
              <button
                type="button"
                class="btn"
                onClick={() => void reviewRunNow(props.run.id)}
              >
                Review what's there
              </button>
              <button
                type="button"
                class="btn btn-accent"
                onClick={() => void resumeRun(props.run.id)}
              >
                Resume
              </button>
            </Match>
            <Match
              when={
                props.run.state === "applied" || props.run.state === "approved"
              }
            >
              <button
                type="button"
                class="btn"
                onClick={() => void discardRun(props.run.id)}
              >
                {props.run.state === "approved"
                  ? "Remove from list"
                  : "Discard…"}
              </button>
            </Match>
          </Switch>
          <Show when={props.run.state !== "approved"}>
            <button type="button" class="btn" onClick={() => void openEditor()}>
              Open in editor
            </button>
          </Show>
          <Show when={props.run.prUrl}>
            {(url) => (
              <code class="pr-link" title="Open it from your browser">
                {url()}
              </code>
            )}
          </Show>
          <Show when={isReview()}>
            <div class="finish-wrap">
              <button
                type="button"
                class="btn btn-accent"
                aria-expanded={finishing()}
                onClick={() => setFinishing((v) => !v)}
              >
                Finish review
                <Show when={pending() > 0}>
                  <span class="count-badge">{pending()}</span>
                </Show>
                <ChevronDown size={12} />
              </button>
              <Show when={finishing()}>
                <FinishReview
                  run={props.run}
                  onClose={() => setFinishing(false)}
                />
              </Show>
            </div>
          </Show>
          <Show
            when={
              props.run.state === "running" ||
              props.run.state === "finishing" ||
              props.run.state === "paused"
            }
          >
            <button
              type="button"
              class="btn btn-accent"
              disabled
              title="Available when Claude finishes"
            >
              Finish review
            </button>
          </Show>
        </div>
      </div>
      <h1 class="run-title">{title()}</h1>
      <div class="run-meta">
        <AccountBadge
          label={account().label}
          color={account().color}
          size="sm"
        />
        <span>{account().label}</span>
        <span class="muted">wants to merge into</span>
        <code>{props.run.base}</code>
        <span class="muted">from</span>
        <code>{props.run.branch}</code>
        <span class="muted">· {plural(props.run.stats.files, "file")} ·</span>
        <span class="stat-add">+{props.run.stats.additions}</span>
        <span class="stat-del">−{props.run.stats.deletions}</span>
      </div>
      <Show when={props.run.checks.length > 0}>
        <div class="run-checks">
          <For each={props.run.checks}>
            {(check) => (
              <span
                class={`check-pill ${check.passed ? "is-pass" : "is-fail"}`}
                title={check.tail}
              >
                {check.passed ? "✓" : "✗"} <code>{check.command}</code>{" "}
                {check.passed ? "passed" : "failed"}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.run.note}>
        {(note) => (
          <div
            class="banner"
            classList={{
              "banner-red": props.run.state === "interrupted",
              "banner-amber": props.run.state === "paused",
            }}
          >
            {note()}
          </div>
        )}
      </Show>
      <Show when={overlapsFor(props.run).length > 0}>
        <div class="banner banner-amber">
          Another active run changes the same files:{" "}
          {overlapsFor(props.run).join(", ")}
        </div>
      </Show>
      <Show
        when={
          isReview() &&
          props.run.revision > 1 &&
          props.run.comments.some(
            (c) =>
              c.state === "resolved" && c.revision === props.run.revision - 1,
          )
        }
      >
        <div class="banner banner-blue">
          Revision {props.run.revision}: Claude worked through{" "}
          {plural(
            props.run.comments.filter(
              (c) =>
                c.state === "resolved" && c.revision === props.run.revision - 1,
            ).length,
            "comment",
          )}
          .
        </div>
      </Show>
    </header>
  );
}

function RunView(props: { run: Run }) {
  const tab = () => tabOf(props.run);
  // While the Changes tab shows a working run, refresh now and then besides Claude's edits.
  createEffect(() => {
    if (tab() !== "changes") return;
    void refreshChanges(props.run.id);
    if (props.run.state !== "running") return;
    const timer = window.setInterval(
      () => void refreshChanges(props.run.id),
      5000,
    );
    onCleanup(() => window.clearInterval(timer));
  });
  const fileCount = () =>
    runs.changes[props.run.id]?.data?.files.length ?? props.run.stats.files;
  return (
    <section class="run-view" aria-label={props.run.title}>
      <RunHeader run={props.run} />
      <div class="run-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="run-tab"
          aria-selected={tab() === "conversation"}
          onClick={() => setTab(props.run.id, "conversation")}
        >
          Conversation
        </button>
        <button
          type="button"
          role="tab"
          class="run-tab"
          aria-selected={tab() === "changes"}
          disabled={fileCount() === 0 && props.run.state === "running"}
          onClick={() => setTab(props.run.id, "changes")}
        >
          Changes <span class="count-badge">{fileCount()}</span>
        </button>
      </div>
      <Switch>
        <Match when={tab() === "conversation"}>
          <Conversation run={props.run} />
        </Match>
        <Match when={tab() === "changes"}>
          <RunChanges run={props.run} />
        </Match>
      </Switch>
    </section>
  );
}

export function Agentic() {
  onMount(() => {
    if (!accounts.loaded) void loadAccounts();
    if (!runs.loaded) void loadRuns();
  });
  createEffect(
    on(
      () => [runs.creating, state.project] as const,
      ([creating, project]) => {
        if (creating && !runs.newRun && project) void startNewRun();
      },
    ),
  );
  const run = createMemo(() => (runs.creating ? undefined : selectedRun()));
  return (
    <div class="agentic-layout" classList={{ "with-files": !!state.project }}>
      <div class="sidebar-slot">
        <RunsList />
        <Resizer
          label="Resize runs list"
          edge="right"
          value={state.settings.runsWidth}
          min={WIDTHS.runsWidth[0]}
          max={WIDTHS.runsWidth[1]}
          defaultValue={DEFAULT_SETTINGS.runsWidth}
          onChange={(runsWidth) => updateSettings({ runsWidth })}
        />
      </div>
      <main class="agentic-main">
        <Show when={runs.error}>
          {(error) => (
            <div class="banner banner-red runs-error">
              {error()}
              <button
                type="button"
                class="btn btn-sm"
                onClick={dismissRunsError}
              >
                Dismiss
              </button>
            </div>
          )}
        </Show>
        <Switch>
          <Match when={state.project ? run() : undefined}>
            {(r) => <RunView run={r()} />}
          </Match>
          <Match when={true}>
            <NewRunForm />
          </Match>
        </Switch>
      </main>
      <Show when={state.project}>
        <div class="sidebar-slot">
          <Explorer right />
          <Resizer
            label="Resize file tree"
            edge="left"
            value={state.settings.runFilesWidth}
            min={WIDTHS.runFilesWidth[0]}
            max={WIDTHS.runFilesWidth[1]}
            defaultValue={DEFAULT_SETTINGS.runFilesWidth}
            onChange={(runFilesWidth) => updateSettings({ runFilesWidth })}
          />
        </div>
      </Show>
    </div>
  );
}

/** The top bar's "New run" button. */
export function NewRunButton() {
  return (
    <button
      type="button"
      class="btn btn-accent"
      disabled={!state.project}
      onClick={() => void startNewRun()}
    >
      <PlusIcon size={13} /> New run
    </button>
  );
}
