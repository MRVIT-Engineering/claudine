// The chat input used everywhere Claude is told something: the Editor chat, a new run and
// a run's conversation. Enter sends, Shift+Enter is a new line, Shift+Tab cycles the mode.
import { createSignal, For, type JSX, onMount, Show } from "solid-js";
import {
  type ChatImage,
  drawThumbnail,
  MAX_IMAGES,
  readImage,
} from "../lib/images";
import { modeTone } from "../lib/modes";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { ArrowUp, CloseIcon } from "./Icons";
import { previewImage } from "./ImagePreview";

export interface Picker {
  value: string;
  options: DropdownOption<string>[];
  onChange: (value: string) => void;
  title?: string;
}

export function ChatInput(props: {
  /** Sends the text and any pasted images; both are cleared when this returns true. */
  onSend: (text: string, images: ChatImage[]) => Promise<boolean> | boolean;
  /** Whether images can be pasted. */
  images?: boolean;
  placeholder: string;
  label?: string;
  rows?: number;
  disabled?: boolean;
  /** Whether sending is allowed, besides having text. */
  canSend?: boolean;
  sendLabel?: string;
  autofocus?: boolean;
  /** The Claude account; shown first. */
  account?: Picker;
  mode?: Picker;
  model?: Picker;
  /** Shown only when the model takes effort levels. */
  effort?: Picker;
  /** Escape, for stopping a turn. */
  onEscape?: () => void;
  /** Set while Claude is working: with nothing typed, the send button stops the turn. */
  onStop?: () => void;
  /** Drawn after the pickers, such as a Stop button or a hint. */
  children?: JSX.Element;
}) {
  const [text, setText] = createSignal("");
  const [images, setImages] = createSignal<ChatImage[]>([]);
  const [problem, setProblem] = createSignal("");
  let input!: HTMLTextAreaElement;
  const ready = () =>
    (text().trim().length > 0 || images().length > 0) &&
    !props.disabled &&
    props.canSend !== false;

  const send = async () => {
    if (!ready()) return;
    if (await props.onSend(text(), images())) {
      setText("");
      setImages([]);
      setProblem("");
    }
  };

  const onPaste = async (event: ClipboardEvent) => {
    if (!props.images) return;
    const files = [...(event.clipboardData?.files ?? [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    // Pasted text, if any, still goes in as text.
    if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
    setProblem("");
    for (const file of files) {
      if (images().length >= MAX_IMAGES) {
        setProblem(`One message can carry up to ${MAX_IMAGES} images.`);
        return;
      }
      const read = await readImage(file);
      if (typeof read === "string") setProblem(read);
      else setImages((list) => [...list, read]);
    }
  };

  const cycleMode = () => {
    const mode = props.mode;
    if (!mode || mode.options.length === 0) return;
    const index = mode.options.findIndex((o) => o.value === mode.value);
    const next = mode.options[(index + 1) % mode.options.length];
    if (next) mode.onChange(next.value);
  };

  onMount(() => {
    if (props.autofocus) input.focus();
  });

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Show when={images().length > 0}>
        <ul class="composer-images" aria-label="Pasted images">
          <For each={images()}>
            {(image, index) => (
              <li>
                <button
                  type="button"
                  class="composer-image"
                  title="Preview"
                  aria-label={`Preview image ${index() + 1}`}
                  onClick={() => previewImage(image.blob)}
                >
                  <canvas
                    width={96}
                    height={96}
                    ref={(canvas) => void drawThumbnail(canvas, image.blob)}
                  />
                </button>
                <button
                  type="button"
                  class="composer-image-remove"
                  aria-label={`Remove image ${index() + 1}`}
                  onClick={() =>
                    setImages((list) => list.filter((i) => i.id !== image.id))
                  }
                >
                  <CloseIcon size={10} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={problem()}>
        <p class="composer-problem">{problem()}</p>
      </Show>
      <textarea
        ref={input}
        onPaste={(e) => void onPaste(e)}
        aria-label={props.label ?? "Message Claude"}
        placeholder={props.placeholder}
        rows={props.rows ?? 2}
        disabled={props.disabled}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape" && props.onEscape) {
            e.preventDefault();
            props.onEscape();
          } else if (e.key === "Tab" && e.shiftKey && props.mode) {
            // Like the terminal: Shift+Tab cycles the mode.
            e.preventDefault();
            cycleMode();
          }
        }}
      />
      <div class="composer-row">
        <Show when={props.account && props.account.options.length > 0}>
          <Dropdown
            label="Account"
            up
            class="model-picker account-picker-inline"
            title={props.account?.title}
            value={props.account?.value ?? ""}
            options={props.account?.options ?? []}
            onChange={(value) => props.account?.onChange(value)}
          />
        </Show>
        <Show when={props.mode}>
          {(mode) => (
            <Dropdown
              label="Mode"
              up
              class={`mode-picker mode-${modeTone(mode().value)}`}
              title={`${mode().title ?? "Claude Code's mode."} Shift+Tab switches.`}
              value={mode().value}
              options={mode().options}
              onChange={mode().onChange}
            />
          )}
        </Show>
        <Show when={props.model && props.model.options.length > 0}>
          <Dropdown
            label="Model"
            up
            class="model-picker"
            title={props.model?.title}
            value={props.model?.value ?? ""}
            options={props.model?.options ?? []}
            onChange={(value) => props.model?.onChange(value)}
          />
        </Show>
        <Show when={props.effort && props.effort.options.length > 1}>
          <Dropdown
            label="Effort"
            up
            class="model-picker effort-picker"
            title={props.effort?.title}
            value={props.effort?.value ?? "default"}
            options={props.effort?.options ?? []}
            onChange={(value) => props.effort?.onChange(value)}
          />
        </Show>
        {props.children}
        <span class="spacer" />
        <Show
          when={props.onStop && !ready()}
          fallback={
            <button
              type="submit"
              class="send-btn"
              aria-label={props.sendLabel ?? "Send"}
              disabled={!ready()}
            >
              <ArrowUp />
            </button>
          }
        >
          <button
            type="button"
            class="send-btn stop-btn"
            aria-label="Stop"
            title="Stop this turn (Esc)"
            onClick={() => props.onStop?.()}
          >
            <span class="stop-dot" />
          </button>
        </Show>
      </div>
    </form>
  );
}
