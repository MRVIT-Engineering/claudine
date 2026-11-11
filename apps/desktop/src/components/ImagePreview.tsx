// A pasted image shown large in the middle of the window. Click outside it or press
// Escape to close. Drawn on a canvas, like the thumbnails, since the CSP has no `blob:`.
import { createSignal, onMount, Show } from "solid-js";
import { drawFull } from "../lib/images";
import { CloseIcon } from "./Icons";

const [shown, setShown] = createSignal<Blob | null>(null);

/** Opens the preview for one image. */
export function previewImage(blob: Blob) {
  setShown(blob);
}

function Preview(props: { blob: Blob }) {
  let dialog!: HTMLDialogElement;
  let canvas!: HTMLCanvasElement;
  onMount(() => {
    dialog.showModal();
    void drawFull(canvas, props.blob);
  });
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a modal dialog closes on Escape by itself.
    <dialog
      ref={dialog}
      class="image-preview"
      aria-label="Image preview"
      onClose={() => setShown(null)}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => {
        if (e.target === dialog) dialog.close();
      }}
    >
      <canvas ref={canvas} />
      <button
        type="button"
        class="icon-btn image-preview-close"
        aria-label="Close preview"
        onClick={() => dialog.close()}
      >
        <CloseIcon />
      </button>
    </dialog>
  );
}

export function ImagePreview() {
  return <Show when={shown()}>{(blob) => <Preview blob={blob()} />}</Show>;
}
