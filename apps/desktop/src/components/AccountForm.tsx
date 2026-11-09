import { createSignal, onCleanup, Show } from "solid-js";
import { ACCOUNT_COLORS, connectAccount, state } from "../state/store";
import { ColorPicker } from "./Common";

export function AccountForm(props: { onDone: () => void }) {
  const unused = ACCOUNT_COLORS.find(
    (color) => !state.accounts.some((a) => a.color === color),
  );
  const [label, setLabel] = createSignal("");
  const [color, setColor] = createSignal(unused ?? "blue");
  const [signingIn, setSigningIn] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));

  const signIn = (event: SubmitEvent) => {
    event.preventDefault();
    if (!label().trim() || signingIn()) return;
    setSigningIn(true);
    timer = window.setTimeout(() => {
      connectAccount(label(), color());
      props.onDone();
    }, 900);
  };

  return (
    <form class="connect-form" onSubmit={signIn}>
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
      <p class="hint">
        Claude Code's sign-in opens in your browser. Claudine only remembers
        which config folder belongs to this account.
      </p>
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={signingIn()}
          onClick={props.onDone}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-accent"
          disabled={!label().trim() || signingIn()}
        >
          <Show when={signingIn()} fallback="Sign in with Claude">
            Waiting for browser…
          </Show>
        </button>
      </div>
    </form>
  );
}
