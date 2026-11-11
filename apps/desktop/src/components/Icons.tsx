import type { JSX } from "solid-js";

function Svg(props: { children: JSX.Element; size?: number }) {
  return (
    <svg
      class="icon"
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

type IconProps = { size?: number };

export const LogoIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
  </Svg>
);
export const ChevronRight = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const ChevronDown = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const FolderIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const SplitIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </Svg>
);
export const ColumnsIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="10" y="4" width="5" height="16" rx="1" />
    <rect x="17" y="4" width="4" height="16" rx="1" />
  </Svg>
);
export const BoltIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const MinusIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M5 12h14" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
export const ArrowRight = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const ArrowUp = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const PaletteIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-3 1-2 2-2h3a3 3 0 0 0 3-3c0-4.5-4-8-9-8Z" />
    <path d="M7.5 11.5h.01M11 7.5h.01M16 8.5h.01" />
  </Svg>
);
export const CodeIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M16 4.8a3.5 3.5 0 0 1 0 6.400M18 14.5c2 .8 3 2.8 3 5.5" />
  </Svg>
);
export const MonitorIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
export const FilesIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M15 3H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7Z" />
    <path d="M15 3v4h4M3 7v13a1 1 0 0 0 1 1h11" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.5-4.5" />
  </Svg>
);
export const SunIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const GitIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="8" r="2" />
    <path d="M6 7v10M18 10c0 4-6 3-12 7" />
  </Svg>
);
export const EyeIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const FolderOpenIcon = (p: IconProps) => (
  <Svg size={p.size}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v1" />
    <path d="M3 19 5.5 11h16L19 19Z" />
  </Svg>
);
