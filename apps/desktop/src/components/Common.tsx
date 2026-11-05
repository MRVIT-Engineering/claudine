import { For, type JSX, onMount, Show } from "solid-js";
import { ACCOUNT_COLORS, letterOf } from "../state/store";
import type { Account, AccountColor, SessionStatus } from "../types";
import { CloseIcon } from "./Icons";

export function AccountBadge(props: {
  label: string;
  color: AccountColor;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span class={`badge badge-${props.size ?? "md"} acct-${props.color}`}>
      {letterOf(props.label)}
    </span>
  );
}

export function AccountChip(props: { account: Account }) {
  return (
    <span class={`account-chip acct-${props.account.color}`}>
      <b>{letterOf(props.account.label)}</b> {props.account.label}
    </span>
  );
}

export const STATUS_WORD: Record<SessionStatus, string> = {
  review: "review",
  running: "running",
  waiting: "waiting",
  idle: "idle",
};

export const STATUS_LABEL: Record<SessionStatus, string> = {
  review: "Needs review",
  running: "Running",
  waiting: "Waiting on you",
  idle: "Idle",
};

export function ColorPicker(props: {
  value: AccountColor;
  onChange: (color: AccountColor) => void;
}) {
  return (
    <fieldset class="swatches">
      <legend class="field-label">Color</legend>
      <For each={ACCOUNT_COLORS}>
        {(color) => (
          <label class={`swatch acct-${color}`} title={color}>
            <input
              class="sr-only"
              type="radio"
              name="account-color"
              checked={props.value === color}
              onChange={() => props.onChange(color)}
            />
            <span class="swatch-dot" />
            <span class="sr-only">{color}</span>
          </label>
        )}
      </For>
    </fieldset>
  );
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());
  return (
    <dialog ref={dialog} class="modal" onClose={props.onClose}>
      <header class="modal-head">
        <h2>{props.title}</h2>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close"
          onClick={() => dialog.close()}
        >
          <CloseIcon />
        </button>
      </header>
      {props.children}
    </dialog>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="toggle">
      <input
        class="sr-only"
        type="checkbox"
        aria-label={props.label}
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="toggle-track" />
    </label>
  );
}

export function Empty(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="empty">
      <strong>{props.title}</strong>
      <Show when={props.children}>
        <span>{props.children}</span>
      </Show>
    </div>
  );
}
