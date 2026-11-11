// ⇧↵ allows and ⇧N denies the oldest permission request on screen. Each card registers
// while it's shown; cards mount oldest first, so the first one registered is answered.
type Answer = (allow: boolean) => void;

const cards: Answer[] = [];

/** The text in a field the user is typing in, or `null` when focus isn't in one. */
function fieldText(target: EventTarget | undefined): string | null {
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement
  ) {
    return target.value;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return target.textContent ?? "";
  }
  return null;
}

function onKeyDown(event: KeyboardEvent) {
  const answer = cards[0];
  if (!answer || !event.shiftKey || event.isComposing || event.repeat) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // The real target, inside a CodeMirror shadow root too.
  const field = fieldText(event.composedPath()[0]);
  let allow: boolean;
  if (event.key === "Enter") {
    // ⇧↵ in a field with text is still a new line.
    if (field) return;
    allow = true;
  } else if (event.key === "N" || event.key === "n") {
    // In any field, ⇧N types a capital N.
    if (field !== null) return;
    allow = false;
  } else {
    return;
  }
  event.preventDefault();
  answer(allow);
}

/** Lets the keys answer this card while it's shown. Returns the cleanup. */
export function registerPermissionKeys(answer: Answer): () => void {
  if (cards.length === 0) window.addEventListener("keydown", onKeyDown);
  cards.push(answer);
  return () => {
    const index = cards.indexOf(answer);
    if (index >= 0) cards.splice(index, 1);
    if (cards.length === 0) window.removeEventListener("keydown", onKeyDown);
  };
}
