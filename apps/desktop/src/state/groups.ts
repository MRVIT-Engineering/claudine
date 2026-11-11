// The editor's tab groups: a tree of splits, with tabs at the leaves. Each tab is in one
// group only, so each file has one editor. These functions don't change the tree they
// get; they return a new one, which the store reconciles by id.

export type Side = "left" | "right" | "top" | "bottom";

export interface Group {
  kind: "group";
  id: string;
  tabs: string[];
  /** The tab shown, or "" when the group is empty. */
  active: string;
}

export interface Split {
  kind: "split";
  id: string;
  /** "row" puts the two side by side; "column" puts one above the other. */
  dir: "row" | "column";
  first: Layout;
  second: Layout;
}

export type Layout = Group | Split;

let nextId = 1;
const newId = (prefix: string) => `${prefix}${nextId++}`;

export function newGroup(tabs: string[] = []): Group {
  return { kind: "group", id: newId("g"), tabs, active: tabs[0] ?? "" };
}

/** Every group, left to right and top to bottom. */
export function allGroups(node: Layout): Group[] {
  return node.kind === "group"
    ? [node]
    : [...allGroups(node.first), ...allGroups(node.second)];
}

export function findGroup(node: Layout, id: string): Group | undefined {
  return allGroups(node).find((g) => g.id === id);
}

export function groupWithTab(node: Layout, tab: string): Group | undefined {
  return allGroups(node).find((g) => g.tabs.includes(tab));
}

/** Replaces each group with what `change` returns. */
function mapGroups(node: Layout, change: (g: Group) => Layout): Layout {
  if (node.kind === "group") return change(node);
  return {
    ...node,
    first: mapGroups(node.first, change),
    second: mapGroups(node.second, change),
  };
}

/** Drops empty groups, unless it's the only one left. */
function prune(node: Layout): Layout {
  if (node.kind === "group") return node;
  const first = prune(node.first);
  const second = prune(node.second);
  const empty = (n: Layout) => n.kind === "group" && n.tabs.length === 0;
  if (empty(first)) return second;
  if (empty(second)) return first;
  return { ...node, first, second };
}

/** The group without `tab`. When it was shown, its left neighbour is shown instead. */
function without(group: Group, tab: string): Group {
  const index = group.tabs.indexOf(tab);
  if (index === -1) return group;
  const tabs = group.tabs.filter((t) => t !== tab);
  const active =
    group.active === tab ? (tabs[Math.max(0, index - 1)] ?? "") : group.active;
  return { ...group, tabs, active };
}

/** Closes `tab` wherever it is. A group left empty goes away. */
export function removeTab(node: Layout, tab: string): Layout {
  return prune(mapGroups(node, (g) => without(g, tab)));
}

/**
 * Shows `tab` in the group `groupId`, at `index` (the end by default), moving it from
 * another group if it's open there.
 */
export function placeTab(
  node: Layout,
  groupId: string,
  tab: string,
  index?: number,
): Layout {
  const moved = mapGroups(node, (g) => {
    if (g.id !== groupId) return without(g, tab);
    const tabs = g.tabs.filter((t) => t !== tab);
    // Reordering in the same bar: the index was measured with the tab still in it.
    const from = g.tabs.indexOf(tab);
    let at = index ?? tabs.length;
    if (from !== -1 && from < at) at -= 1;
    tabs.splice(Math.min(Math.max(at, 0), tabs.length), 0, tab);
    return { ...g, tabs, active: tab };
  });
  return prune(moved);
}

/**
 * Splits the group `groupId`, putting `tab` in a new group on `side` of it. Returns the
 * new tree and the new group's id.
 */
export function splitWith(
  node: Layout,
  groupId: string,
  side: Side,
  tab: string,
): { layout: Layout; id: string } {
  const added = newGroup([tab]);
  const split = mapGroups(removeTabKeepingEmpty(node, tab), (g) => {
    if (g.id !== groupId) return g;
    const before = side === "left" || side === "top";
    return {
      kind: "split",
      id: newId("s"),
      dir: side === "left" || side === "right" ? "row" : "column",
      first: before ? added : g,
      second: before ? g : added,
    };
  });
  return { layout: prune(split), id: added.id };
}

/** Like `removeTab`, but keeps empty groups until the split is made. */
function removeTabKeepingEmpty(node: Layout, tab: string): Layout {
  return mapGroups(node, (g) => without(g, tab));
}
