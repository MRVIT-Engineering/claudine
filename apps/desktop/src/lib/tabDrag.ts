// Dragging editor tabs: onto another tab bar to move or reorder, or onto an edge of a
// group to split it. Pointer events, not HTML drag and drop, since the desktop window
// handles file drops itself and the browser's drag image can't be styled.
import { createSignal } from "solid-js";
import type { Side } from "../state/groups";
import { moveTab, splitTab } from "../state/store";

export type DropTarget =
  | { kind: "bar"; groupId: string; index: number }
  | { kind: "zone"; groupId: string; zone: Side | "center" };

interface Dragging {
  tab: string;
  label: string;
  x: number;
  y: number;
}

const [dragging, setDragging] = createSignal<Dragging | null>(null);
const [dropTarget, setDropTarget] = createSignal<DropTarget | null>(null);

export { dragging, dropTarget };

/** How far the pointer moves before a press becomes a drag, in pixels. */
const THRESHOLD = 5;
/** How close to an edge, as a share of the group, a drop splits instead of moving. */
const EDGE = 0.25;

function targetAt(x: number, y: number): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  const bar = element?.closest<HTMLElement>("[data-tabbar]");
  if (bar?.dataset.tabbar) {
    const tabs = [...bar.querySelectorAll<HTMLElement>("[data-tab]")];
    let index = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    if (index === -1) index = tabs.length;
    return { kind: "bar", groupId: bar.dataset.tabbar, index };
  }
  const body = element?.closest<HTMLElement>("[data-group-body]");
  if (body?.dataset.groupBody) {
    const rect = body.getBoundingClientRect();
    const fx = (x - rect.left) / rect.width;
    const fy = (y - rect.top) / rect.height;
    const distances: [Side, number][] = [
      ["left", fx],
      ["right", 1 - fx],
      ["top", fy],
      ["bottom", 1 - fy],
    ];
    const [side, distance] = distances.reduce((a, b) => (b[1] < a[1] ? b : a));
    return {
      kind: "zone",
      groupId: body.dataset.groupBody,
      zone: distance < EDGE ? side : "center",
    };
  }
  return null;
}

function drop(tab: string, target: DropTarget) {
  if (target.kind === "bar") moveTab(tab, target.groupId, target.index);
  else if (target.zone === "center") moveTab(tab, target.groupId);
  else splitTab(tab, target.groupId, target.zone);
}

/** Starts watching a press on a tab; it becomes a drag once the pointer moves. */
export function startTabDrag(tab: string, label: string, event: PointerEvent) {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let moving = false;

  const onMove = (e: PointerEvent) => {
    if (
      !moving &&
      Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD
    )
      return;
    if (!moving) {
      moving = true;
      document.body.classList.add("dragging-tab");
    }
    setDragging({ tab, label, x: e.clientX, y: e.clientY });
    setDropTarget(targetAt(e.clientX, e.clientY));
  };
  const finish = (apply: boolean) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("dragging-tab");
    const target = dropTarget();
    setDragging(null);
    setDropTarget(null);
    if (apply && moving && target) drop(tab, target);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}
