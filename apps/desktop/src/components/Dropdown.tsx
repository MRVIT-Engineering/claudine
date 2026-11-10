// A select drawn by the app instead of the OS: a button that opens a list of buttons.
// Keyboard: Enter, Space or the arrows open it; arrows move; Enter picks; Escape closes.
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { CheckIcon, ChevronDown } from "./Icons";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  /** Drawn before the label, in the button and the list. */
  icon?: JSX.Element;
}

export function Dropdown<T extends string>(props: {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  class?: string;
  /** Extra classes that change with state. */
  classes?: Record<string, boolean | undefined>;
  /** Opens above the button, for controls at the bottom of the window. */
  up?: boolean;
  title?: string;
}) {
  let root!: HTMLDivElement;
  let button!: HTMLButtonElement;
  let list: HTMLFieldSetElement | undefined;
  const [open, setOpen] = createSignal(false);

  const current = () => props.options.find((o) => o.value === props.value);
  const items = () =>
    Array.from(list?.querySelectorAll("button") ?? []) as HTMLButtonElement[];
  const focusItem = (index: number) => {
    const all = items();
    if (all.length) all[(index + all.length) % all.length]?.focus();
  };

  const onOutside = (event: PointerEvent) => {
    if (!event.composedPath().includes(root)) close(false);
  };
  const show = () => {
    setOpen(true);
    document.addEventListener("pointerdown", onOutside, true);
    const index = props.options.findIndex((o) => o.value === props.value);
    queueMicrotask(() => focusItem(Math.max(index, 0)));
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    document.removeEventListener("pointerdown", onOutside, true);
    if (refocus) button.focus();
  };
  onCleanup(() => document.removeEventListener("pointerdown", onOutside, true));

  const pick = (option: DropdownOption<T>) => {
    close(true);
    if (option.value !== props.value) props.onChange(option.value);
  };

  const onListKey = (event: KeyboardEvent) => {
    const index = items().indexOf(document.activeElement as HTMLButtonElement);
    const keys: Record<string, () => void> = {
      ArrowDown: () => focusItem(index + 1),
      ArrowUp: () => focusItem(index - 1),
      Home: () => focusItem(0),
      End: () => focusItem(-1),
      Escape: () => close(true),
    };
    const run = keys[event.key];
    if (event.key === "Tab") close(false);
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  return (
    <div
      ref={root}
      class={`dropdown ${props.class ?? ""}`}
      classList={{ ...props.classes, open: open(), up: props.up }}
    >
      <button
        ref={button}
        type="button"
        class="dropdown-button"
        aria-haspopup="true"
        aria-expanded={open()}
        aria-label={`${props.label}: ${current()?.label ?? props.value}`}
        title={props.title}
        onClick={() => (open() ? close(true) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        {current()?.icon}
        <span class="dropdown-value">{current()?.label ?? props.value}</span>
        <ChevronDown size={12} />
      </button>
      <Show when={open()}>
        <fieldset
          ref={list}
          class="dropdown-list"
          aria-label={props.label}
          onKeyDown={onListKey}
        >
          <For each={props.options}>
            {(option) => (
              <button
                type="button"
                class="dropdown-option"
                aria-current={option.value === props.value ? "true" : undefined}
                onPointerMove={(e) => e.currentTarget.focus()}
                onClick={() => pick(option)}
              >
                {option.icon}
                <span class="dropdown-text">
                  <span class="dropdown-label">{option.label}</span>
                  <Show when={option.hint}>
                    <span class="dropdown-hint">{option.hint}</span>
                  </Show>
                </span>
                <span class="dropdown-check">
                  <Show when={option.value === props.value}>
                    <CheckIcon size={12} />
                  </Show>
                </span>
              </button>
            )}
          </For>
        </fieldset>
      </Show>
    </div>
  );
}
