// A file's icon, picked by lib/fileTypes.ts. Colors are SVG attributes, which the CSP
// allows; inline `style` would be blocked.
import { type JSX, Match, Switch } from "solid-js";
import { type FileType, fileType, type Glyph } from "../lib/fileTypes";
import { FileIcon } from "./Icons";

/** Stroke drawings on the same 24-unit grid as Icons.tsx. */
const GLYPHS: Record<Glyph, (color: string) => JSX.Element> = {
  node: (color) => (
    <>
      <path d="M12 2.5 20.5 7.3v9.4L12 21.5l-8.5-4.8V7.3Z" fill={color} />
      <path d="M9.5 15.5v-7l5 7v-7" stroke="#10220a" stroke-width="1.8" />
    </>
  ),
  git: (color) => (
    <g stroke={color}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 8.2v7.6M18 11.2c0 3-3 4-9.8 5.6" />
    </g>
  ),
  key: (color) => (
    <g stroke={color}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M16 7l2.5 2.5M14 9l2 2" />
    </g>
  ),
  gear: (color) => (
    <g stroke={color}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </g>
  ),
  lock: (color) => (
    <g stroke={color}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </g>
  ),
  image: (color) => (
    <g stroke={color}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-9 9" />
    </g>
  ),
  atom: (color) => (
    <g stroke={color} stroke-width="1.6">
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="1.6" fill={color} stroke="none" />
    </g>
  ),
  database: (color) => (
    <g stroke={color}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </g>
  ),
  archive: (color) => (
    <g stroke={color}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M12 3v2M12 7v2M12 11v2M10.5 15h3v3h-3Z" />
    </g>
  ),
  lines: (color) => (
    <g stroke={color}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </g>
  ),
  info: (color) => (
    <g stroke={color}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </g>
  ),
  box: (color) => (
    <g stroke={color}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </g>
  ),
  terminal: (color) => (
    <g stroke={color}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </g>
  ),
  code: (color) => (
    <g stroke={color}>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
    </g>
  ),
};

function Badge(props: {
  type: Extract<FileType, { kind: "badge" }>;
  size: number;
}) {
  const fontSize = () => (props.type.label.length > 2 ? "6.2" : "8");
  return (
    <svg
      class="icon file-type"
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="1.5"
        width="15"
        height="13"
        rx="2.5"
        fill={props.type.color}
      />
      <text
        x="8"
        y="8.3"
        text-anchor="middle"
        dominant-baseline="central"
        font-size={fontSize()}
        font-weight="700"
        fill={props.type.dark ? "#1b1b1b" : "#ffffff"}
      >
        {props.type.label}
      </text>
    </svg>
  );
}

function GlyphIcon(props: {
  type: Extract<FileType, { kind: "glyph" }>;
  size: number;
}) {
  return (
    <svg
      class="icon file-type"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[props.type.glyph](props.type.color)}
    </svg>
  );
}

/** The icon for `name`, or the plain file icon for types it doesn't know. */
export function FileTypeIcon(props: { name: string; size?: number }) {
  const type = () => fileType(props.name);
  const size = () => props.size ?? 14;
  const badge = () => {
    const t = type();
    return t?.kind === "badge" ? t : undefined;
  };
  const glyph = () => {
    const t = type();
    return t?.kind === "glyph" ? t : undefined;
  };
  return (
    <Switch fallback={<FileIcon size={size()} />}>
      <Match when={badge()}>{(t) => <Badge type={t()} size={size()} />}</Match>
      <Match when={glyph()}>
        {(t) => <GlyphIcon type={t()} size={size()} />}
      </Match>
    </Switch>
  );
}
