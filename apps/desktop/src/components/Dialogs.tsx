import { createSignal, For, Show } from "solid-js";
import {
  createSession,
  defaultAccountId,
  dialog,
  navigate,
  openProjectFolder,
  sendMessage,
  setDialog,
  state,
} from "../state/store";
import { Modal } from "./Common";

function NewSessionDialog() {
  const signedIn = () => state.accounts.filter((a) => a.signedIn);
  const [accountId, setAccountId] = createSignal(defaultAccountId());
  const [task, setTask] = createSignal("");
  let form!: HTMLFormElement;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!accountId()) return;
    createSession(accountId(), task());
    form.closest("dialog")?.close();
  };

  return (
    <Modal title="New session" onClose={() => setDialog(null)}>
      <Show
        when={signedIn().length > 0}
        fallback={
          <div class="modal-body">
            <p class="hint">Link a signed-in account to start a session.</p>
            <div class="row end">
              <button
                type="button"
                class="btn btn-accent"
                onClick={(e) => {
                  e.currentTarget.closest("dialog")?.close();
                  navigate("accounts");
                }}
              >
                Go to accounts
              </button>
            </div>
          </div>
        }
      >
        <form ref={form} class="modal-body" onSubmit={submit}>
          <label class="field">
            <span class="field-label">Account</span>
            <select
              class="input"
              value={accountId()}
              onChange={(e) => setAccountId(e.currentTarget.value)}
            >
              <For each={signedIn()}>
                {(account) => (
                  <option value={account.id}>{account.label}</option>
                )}
              </For>
            </select>
          </label>
          <label class="field">
            <span class="field-label">What should Claude work on?</span>
            <textarea
              class="input"
              rows="3"
              autofocus
              value={task()}
              onInput={(e) => setTask(e.currentTarget.value)}
            />
          </label>
          <div class="row end">
            <button type="submit" class="btn btn-accent">
              Start session
            </button>
          </div>
        </form>
      </Show>
    </Modal>
  );
}

function BroadcastDialog() {
  const [text, setText] = createSignal("");
  let form!: HTMLFormElement;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!text().trim()) return;
    for (const session of state.sessions) sendMessage(session.id, text());
    form.closest("dialog")?.close();
  };

  return (
    <Modal title="Broadcast prompt" onClose={() => setDialog(null)}>
      <form ref={form} class="modal-body" onSubmit={submit}>
        <label class="field">
          <span class="field-label">
            Sends to all {state.sessions.length} sessions
          </span>
          <textarea
            class="input"
            rows="4"
            autofocus
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
          />
        </label>
        <div class="row end">
          <button
            type="submit"
            class="btn btn-accent"
            disabled={!text().trim()}
          >
            Send to all
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DiscardChangesDialog() {
  let body!: HTMLDivElement;
  const close = () => body.closest("dialog")?.close();
  return (
    <Modal title="Discard unsaved changes?" onClose={() => setDialog(null)}>
      <div ref={body} class="modal-body">
        <p>
          Opening another folder closes this one. Saving isn't built yet, so
          your unsaved edits will be lost.
        </p>
        <div class="row end">
          <button type="button" class="btn" onClick={close}>
            Keep editing
          </button>
          <button
            type="button"
            class="btn btn-danger-solid"
            onClick={() => {
              close();
              void openProjectFolder(true);
            }}
          >
            Discard and open
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  return (
    <>
      <Show when={dialog() === "discard-changes"}>
        <DiscardChangesDialog />
      </Show>
      <Show when={dialog() === "new-session"}>
        <NewSessionDialog />
      </Show>
      <Show when={dialog() === "broadcast"}>
        <BroadcastDialog />
      </Show>
    </>
  );
}
