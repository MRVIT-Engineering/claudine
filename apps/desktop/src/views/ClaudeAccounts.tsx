// The real Claude accounts: Settings' list and the Claude panel's account picker.
// The Accounts page and its mock data stay with the design preview.
import { createSignal, For, onMount, Show } from "solid-js";
import { DEFAULT_ACCOUNT } from "../backend";
import { AccountBadge, ColorPicker, Modal } from "../components/Common";
import { PlusIcon } from "../components/Icons";
import {
  accountById,
  accounts,
  addAccount,
  cancelSignIn,
  dismissAccountsError,
  isSignedIn,
  loadAccounts,
  refreshStatus,
  removeAccount,
  selectAccount,
  signOut,
  startSignIn,
  submitSignInCode,
  updateAccount,
} from "../state/accounts";
import { ACCOUNT_COLORS } from "../state/store";
import type { AccountColor } from "../types";

function statusText(id: string): string {
  const status = accounts.status[id];
  if (status === undefined || status === "checking") return "Checking…";
  if (status === "error") return "Couldn't check";
  if (!status.signedIn) return "Signed out";
  const plan = status.method === "claude.ai" ? status.plan : "API billing";
  return [status.email, plan].filter(Boolean).join(" · ") || "Signed in";
}

function StatusDot(props: { id: string }) {
  return (
    <span class={`dot ${isSignedIn(props.id) ? "dot-running" : "dot-idle"}`} />
  );
}

/** Shown while `claude auth login` runs for `account`. */
export function SignInBox(props: { account: string }) {
  const [code, setCode] = createSignal("");
  const signIn = () =>
    accounts.signIn?.account === props.account ? accounts.signIn : null;
  return (
    <Show when={signIn()}>
      {(state) => (
        <div class="sign-in-box" role="status">
          <Show
            when={state().error}
            fallback={
              <p>
                <strong>Finish signing in in your browser.</strong> Claude Code
                opened its sign-in page. Claudine never sees your password or
                token.
              </p>
            }
          >
            {(error) => <p class="claude-warning">{error()}</p>}
          </Show>
          <Show when={state().link && !state().error}>
            <details class="sign-in-fallback">
              <summary>The browser didn't open?</summary>
              <label class="field">
                <span class="field-label">Open this link yourself</span>
                <input
                  class="input"
                  type="text"
                  readonly
                  value={state().link ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <form
                class="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await submitSignInCode(code())) setCode("");
                }}
              >
                <input
                  class="input"
                  type="text"
                  placeholder="Paste the code it shows"
                  aria-label="Code from the sign-in page"
                  autocomplete="off"
                  spellcheck={false}
                  value={code()}
                  onInput={(e) => setCode(e.currentTarget.value)}
                />
                <button
                  type="submit"
                  class="btn btn-sm"
                  disabled={!code().trim()}
                >
                  Submit code
                </button>
              </form>
            </details>
          </Show>
          <div class="row">
            <span class="spacer" />
            <Show when={state().error}>
              <button
                type="button"
                class="btn btn-sm"
                onClick={() => void startSignIn(props.account)}
              >
                Try again
              </button>
            </Show>
            <button type="button" class="btn btn-sm" onClick={cancelSignIn}>
              {state().error ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}

function AddAccountForm(props: { onDone: () => void }) {
  const unused = ACCOUNT_COLORS.find(
    (color) => !accounts.list.some((a) => a.color === color),
  );
  const [label, setLabel] = createSignal("");
  const [color, setColor] = createSignal<AccountColor>(unused ?? "blue");
  const [apiBilling, setApiBilling] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!label().trim() || busy()) return;
    setBusy(true);
    const added = await addAccount(label(), color(), apiBilling());
    setBusy(false);
    if (added) props.onDone();
  };

  return (
    <form class="connect-form card" onSubmit={submit}>
      <label class="field">
        <span class="field-label">Label for this account</span>
        <input
          class="input"
          type="text"
          placeholder="Work, Personal…"
          maxlength="40"
          autofocus
          value={label()}
          onInput={(e) => setLabel(e.currentTarget.value)}
        />
      </label>
      <ColorPicker value={color()} onChange={setColor} />
      <label class="check">
        <input
          type="checkbox"
          checked={apiBilling()}
          onChange={(e) => setApiBilling(e.currentTarget.checked)}
        />
        Bill through the Anthropic Console instead of a Claude subscription
      </label>
      <p class="hint">
        Claudine makes a separate Claude Code config folder for this account,
        then Claude Code's own sign-in opens in your browser. Its settings, MCP
        servers and history start empty.
      </p>
      <div class="row">
        <button type="button" class="btn" onClick={props.onDone}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-accent"
          disabled={!label().trim() || busy()}
        >
          Add and sign in
        </button>
      </div>
    </form>
  );
}

function EditDialog(props: { id: string; onClose: () => void }) {
  const account = () => accountById(props.id);
  const [confirming, setConfirming] = createSignal(false);
  const [removing, setRemoving] = createSignal(false);
  return (
    <Show when={account()}>
      {(a) => (
        <Modal title={`Edit ${a().label}`} onClose={props.onClose}>
          <div class="modal-body">
            <label class="field">
              <span class="field-label">Label</span>
              <input
                class="input"
                type="text"
                maxlength="40"
                value={a().label}
                onChange={(e) => {
                  const label = e.currentTarget.value.trim();
                  if (label) void updateAccount(a().id, label, a().color);
                }}
              />
            </label>
            <ColorPicker
              value={a().color}
              onChange={(color) => void updateAccount(a().id, a().label, color)}
            />
            <div class="row">
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
                  disabled={removing()}
                  onClick={async () => {
                    setRemoving(true);
                    const removed = await removeAccount(a().id);
                    setRemoving(false);
                    if (removed) props.onClose();
                  }}
                >
                  Sign out and remove
                </button>
              </Show>
            </div>
          </div>
        </Modal>
      )}
    </Show>
  );
}

export function ClaudeAccountsSection() {
  const [adding, setAdding] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  onMount(() => void loadAccounts());

  return (
    <>
      <h1>Claude accounts</h1>
      <p class="lede">
        Each account is its own Claude Code config folder, with its own login.
        Pick one when you start a session.
      </p>
      <Show when={accounts.error}>
        {(error) => (
          <div class="claude-notice tone-error accounts-error">
            {error()}
            <button
              type="button"
              class="btn btn-sm"
              onClick={dismissAccountsError}
            >
              OK
            </button>
          </div>
        )}
      </Show>
      <ul class="account-list">
        <For each={accounts.list}>
          {(account) => (
            <li class="claude-account">
              <div class="claude-account-row">
                <AccountBadge
                  label={account.label}
                  color={account.color}
                  size="lg"
                />
                <span class="account-name">
                  <strong>{account.label}</strong>
                  <small class="muted truncate">
                    {account.id === DEFAULT_ACCOUNT
                      ? "Your Claude Code login in ~/.claude, shared with the terminal"
                      : "Its own config folder"}
                  </small>
                </span>
                <span class="spacer" />
                <span
                  class={
                    isSignedIn(account.id) ? "signed-in" : "signed-out muted"
                  }
                >
                  <StatusDot id={account.id} />
                  <span class="truncate">{statusText(account.id)}</span>
                </span>
                <Show
                  when={isSignedIn(account.id)}
                  fallback={
                    <button
                      type="button"
                      class="btn btn-sm"
                      disabled={accounts.signIn?.account === account.id}
                      onClick={() => void startSignIn(account.id)}
                    >
                      Sign in
                    </button>
                  }
                >
                  <Show when={account.id !== DEFAULT_ACCOUNT}>
                    <button
                      type="button"
                      class="btn btn-sm"
                      onClick={() => void signOut(account.id)}
                    >
                      Sign out
                    </button>
                  </Show>
                </Show>
                <Show when={account.id !== DEFAULT_ACCOUNT}>
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={() => setEditing(account.id)}
                  >
                    Edit
                  </button>
                </Show>
              </div>
              <SignInBox account={account.id} />
            </li>
          )}
        </For>
      </ul>
      <Show
        when={adding()}
        fallback={
          <button
            type="button"
            class="btn btn-lg reset-btn"
            onClick={() => setAdding(true)}
          >
            <PlusIcon /> Add account
          </button>
        }
      >
        <AddAccountForm onDone={() => setAdding(false)} />
      </Show>
      <p class="hint">
        To sign the default account out, run <code>claude auth logout</code> in
        a terminal. Removing an added account signs it out first, so its login
        doesn't stay in your Keychain.
      </p>
      <Show when={editing()} keyed>
        {(id) => <EditDialog id={id} onClose={() => setEditing(null)} />}
      </Show>
    </>
  );
}

/** Picks the account for the next session, in the Claude panel. */
export function AccountPicker() {
  onMount(() => {
    if (!accounts.loaded) void loadAccounts();
  });
  const selected = () => accountById(accounts.selected);
  return (
    <div class="account-picker">
      <label class="field">
        <span class="field-label">Account</span>
        <select
          class="input"
          value={accounts.selected}
          onChange={(e) => {
            selectAccount(e.currentTarget.value);
            void refreshStatus(e.currentTarget.value);
          }}
        >
          <For each={accounts.list}>
            {(account) => <option value={account.id}>{account.label}</option>}
          </For>
        </select>
      </label>
      <Show when={selected()}>
        {(account) => (
          <span
            class={isSignedIn(account().id) ? "signed-in" : "signed-out muted"}
          >
            <StatusDot id={account().id} />
            <span class="truncate">{statusText(account().id)}</span>
          </span>
        )}
      </Show>
    </div>
  );
}
