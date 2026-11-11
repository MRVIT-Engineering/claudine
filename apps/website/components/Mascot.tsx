// Claudine, from the app's 28 by 28 pixel grid (apps/desktop/src/components/Mascot.tsx),
// split into single pixels so each one can fly in on its own.
import type { CSSProperties } from "react";

const BODY =
  "M6 6.5h11v1h-11zM19 6.5h2v1h-2zM6 7.5h16v1h-16zM5 8.5h18v1h-18zM5 9.5h3v1h-3zM10 9.5h8v2h-8zM20 9.5h3v1h-3zM4 10.5h4v1h-4zM20 10.5h4v1h-4zM4 11.5h20v1h-20zM2 12.5h24v3h-24zM6 15.5h16v4h-16zM6 19.5h2v4h-2zM10 19.5h2v4h-2zM16 19.5h2v4h-2zM20 19.5h2v4h-2z";
const BOW =
  "M17 4.5h2v1h-2zM21 4.5h2v1h-2zM17 5.5h6v1h-6zM17 6.5h2v1h-2zM21 6.5h2v1h-2z";
const EYES = "M8 9.5h2v2h-2zM18 9.5h2v2h-2z";

interface Pixel {
  x: number;
  y: number;
  fill: string;
}

/** Turns `M x y h w v h h -w z` rectangles into 1 by 1 pixels. */
function pixels(d: string, fill: string): Pixel[] {
  const out: Pixel[] = [];
  for (const m of d.matchAll(/M([\d.]+) ([\d.]+)h(\d+)v(\d+)/g)) {
    const [x, y, w, h] = [m[1], m[2], m[3], m[4]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < w; i++)
      for (let j = 0; j < h; j++) out.push({ x: x + i, y: y + j, fill });
  }
  return out;
}

const BODY_PIXELS = pixels(BODY, "#c07afd");
const BOW_PIXELS = pixels(BOW, "#e0bffb");

/** A stable pseudo-random number per pixel, so server and client render the same. */
function noise(x: number, y: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export function Mascot(props: { size?: number; assemble?: boolean }) {
  const size = props.size ?? 28;
  const all = [...BODY_PIXELS, ...BOW_PIXELS];
  return (
    <svg
      className={`mascot${props.assemble ? " is-assembling" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      shapeRendering="crispEdges"
      role="img"
      aria-label="Claudine"
    >
      <g className="mascot-body">
        {all.map((p) => {
          const r = noise(p.x, p.y);
          const style = {
            "--dx": `${(r - 0.5) * 60}px`,
            "--dy": `${(noise(p.y, p.x) - 0.5) * 60}px`,
            "--delay": `${Math.round(r * 500 + p.y * 18)}ms`,
            "--spread": `${Math.round(r * 140)}ms`,
            "--rot": `${Math.round((r - 0.5) * 240)}deg`,
          } as CSSProperties;
          return (
            <rect
              key={`${p.x}-${p.y}`}
              className="px"
              x={p.x}
              y={p.y}
              width={1.02}
              height={1.02}
              fill={p.fill}
              style={style}
            />
          );
        })}
        <path className="mascot-eyes" fill="#15141d" d={EYES} />
      </g>
    </svg>
  );
}
