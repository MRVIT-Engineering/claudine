import { createSignal, For, Show } from "solid-js";
import { AccountForm } from "../components/AccountForm";
import { AccountBadge, ColorPicker, Modal } from "../components/Common";
import { PlusIcon } from "../components/Icons";
import {
  configDirOf,
  removeAccount,
  state,
  updateAccount,
  updatePreview,
} from "../state/store";
import type { Account } from "../types";

function ManageDialog(props: { account: Account; onClose: () => void }) {
  const [confirming, setConfirming] = createSignal(false);
  return (
    <Modal title={`Manage ${props.account.label}`} onClose={props.onClose}>
      <div class="modal-body">
        <label class="field">
          <span class="field-label">Label</span>
          <input
            class="input"
            type="text"
            maxlength="40"
            value={props.account.label}
            onChange={(e) => {
              const label = e.currentTarget.value.trim();
              if (label) updateAccount(props.account.id, { label });
            }}
          />
        </label>
        <ColorPicker
          value={props.account.color}
          onChange={(color) => updateAccount(props.account.id, { color })}
        />
        <div>
          <span class="field-label">Config folder</span>
          <code class="config-path">{configDirOf(props.account)}</code>
        </div>
        <div class="row">
          <button
            type="button"
            class="btn"
            onClick={() =>
              updateAccount(props.account.id, {
                signedIn: !props.account.signedIn,
              })
            }
          >
            {props.account.signedIn ? "Sign out" : "Sign in with Claude"}
          </button>
          <span class="spacer" />
          <Show
            when={confirming()}
            fallback={
              <button
                type="button"
                class="btn btn-danger"
                onClick={() => setConfirming(true)}
              >
                Remove account
              </button>
            }
          >
            <button
              type="button"
              class="btn btn-danger-solid"
              onClick={() => removeAccount(props.account.id)}
            >
              Remove account and its sessions
            </button>
          </Show>
        </div>
      </div>
    </Modal>
  );
}

export function AccountList() {
  const [managing, setManaging] = createSignal<string | null>(null);
  const managed = () => state.accounts.find((a) => a.id === managing());
  const sessionCount = (id: string) =>
    state.sessions.filter((s) => s.accountId === id).length;

  return (
    <>
      <ul class="account-list">
        <For each={state.accounts}>
          {(account) => (
            <li>
              <AccountBadge
                label={account.label}
                color={account.color}
                size="lg"
              />
              <span class="account-name">
                <strong>{account.label}</strong>
                <small class="muted">{account.email}</small>
              </span>
              <span class="spacer" />
              <span class={account.signedIn ? "signed-in" : "signed-out muted"}>
                <span
                  class={`dot ${account.signedIn ? "dot-running" : "dot-idle"}`}
                />
                {account.signedIn ? "Signed in" : "Signed out"}
              </span>
              <span class="session-count">
                {sessionCount(account.id)}{" "}
                {sessionCount(account.id) === 1 ? "session" : "sessions"}
              </span>
              <button
                type="button"
                class="btn btn-sm"
                onClick={() => setManaging(account.id)}
              >
                Manage
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={managed()} keyed>
        {(account) => (
          <ManageDialog account={account} onClose={() => setManaging(null)} />
        )}
      </Show>
    </>
  );
}

export function SessionDefaults() {
  return (
    <div class="defaults-form">
      <label class="field">
        <span class="field-label">Start new sessions on</span>
        <select
          class="input"
          value={state.preview.startOn}
          onChange={(e) => updatePreview({ startOn: e.currentTarget.value })}
        >
          <option value="least-busy">Least busy account</option>
          <For each={state.accounts}>
            {(account) => <option value={account.id}>{account.label}</option>}
          </For>
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={state.preview.warnSameFile}
          onChange={(e) =>
            updatePreview({ warnSameFile: e.currentTarget.checked })
          }
        />
        Warn when two sessions edit the same file
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={state.preview.worktreePerSession}
          onChange={(e) =>
            updatePreview({ worktreePerSession: e.currentTarget.checked })
          }
        />
        Give each session its own git worktree
      </label>
    </div>
  );
}

export function AccountsView() {
  const [linking, setLinking] = createSignal(false);
  return (
    <main class="page">
      <div class="page-inner">
        <div class="page-head">
          <div>
            <h1>Linked accounts</h1>
            <p class="lede">
              Each account runs in its own Claude Code process with an isolated
              config directory, so sessions on different accounts can work in
              the same project at the same time.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-lg btn-accent"
            disabled={linking()}
            onClick={() => setLinking(true)}
          >
            <PlusIcon /> Link account
          </button>
        </div>
        <Show when={linking()}>
          <div class="card">
            <AccountForm onDone={() => setLinking(false)} />
          </div>
        </Show>
        <AccountList />
        <div class="card-grid">
          <section class="card">
            <h2>New session defaults</h2>
            <SessionDefaults />
          </section>
          <section class="card">
            <h2>How linking works</h2>
            <ol class="how-list">
              <li>
                Link account opens Claude Code's own sign-in in your browser.
              </li>
              <li>
                Claudine stores nothing but the path to that account's config
                folder.
              </li>
              <li>
                Pick an account when you start a session, or move one later.
              </li>
            </ol>
            <pre class="path-list">
              <For each={state.accounts}>
                {(account) => <div>{configDirOf(account)}</div>}
              </For>
            </pre>
          </section>
        </div>
      </div>
    </main>
  );
}
