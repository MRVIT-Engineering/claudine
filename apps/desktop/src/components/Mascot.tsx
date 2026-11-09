// Claudine, the app's mascot. Traced from apps/desktop/src-tauri/icons/claudine.png
// onto her 24 by 19 pixel grid, so she stays sharp at any size.

export function Mascot(props: { size?: number; class?: string }) {
  return (
    <svg
      class={`mascot ${props.class ?? ""}`}
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 28 28"
      shape-rendering="crispEdges"
      role="img"
      aria-label="Claudine"
    >
      <path
        fill="#c07afd"
        d="M6 6.5h11v1h-11zM19 6.5h2v1h-2zM6 7.5h16v1h-16zM5 8.5h18v1h-18zM5 9.5h3v1h-3zM10 9.5h8v2h-8zM20 9.5h3v1h-3zM4 10.5h4v1h-4zM20 10.5h4v1h-4zM4 11.5h20v1h-20zM2 12.5h24v3h-24zM6 15.5h16v4h-16zM6 19.5h2v4h-2zM10 19.5h2v4h-2zM16 19.5h2v4h-2zM20 19.5h2v4h-2z"
      />
      <path
        fill="#e0bffb"
        d="M17 4.5h2v1h-2zM21 4.5h2v1h-2zM17 5.5h6v1h-6zM17 6.5h2v1h-2zM21 6.5h2v1h-2z"
      />
      <path fill="#15141d" d="M8 9.5h2v2h-2zM18 9.5h2v2h-2z" />
    </svg>
  );
}
