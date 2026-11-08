/**
 * A drag handle on a sidebar's edge. Drag to resize, double-click to reset, or focus it
 * and use the arrow keys. The width is a setting, so it's saved like the others.
 */
export function Resizer(props: {
  label: string;
  /** Which edge of the sidebar the handle sits on. */
  edge: "left" | "right";
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (width: number) => void;
}) {
  let startX = 0;
  let startWidth = 0;
  const clamp = (width: number) =>
    Math.round(Math.min(props.max, Math.max(props.min, width)));
  // Dragging right widens a sidebar on the left of the screen, and narrows one on the right.
  const direction = () => (props.edge === "right" ? 1 : -1);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    startX = event.clientX;
    startWidth = props.value;
    document.body.classList.add("resizing");
  };

  const onPointerMove = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    if (!handle.hasPointerCapture(event.pointerId)) return;
    props.onChange(clamp(startWidth + (event.clientX - startX) * direction()));
  };

  const onPointerUp = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove("resizing");
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    const moves: Record<string, number> = {
      ArrowRight: props.value + step * direction(),
      ArrowLeft: props.value - step * direction(),
      Home: props.min,
      End: props.max,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    props.onChange(clamp(next));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> can't be dragged or focused like this.
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      title="Drag to resize. Double-click to reset."
      class={`resizer resizer-${props.edge}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDblClick={() => props.onChange(props.defaultValue)}
      onKeyDown={onKeyDown}
    />
  );
}
