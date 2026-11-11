"use client";
// Small motion helpers, no animation library: elements fade up when they scroll into
// view, and cards light up where the pointer is.
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

/** Fades its children up once they're on screen. `delay` is in milliseconds. */
export function Reveal(props: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Already on screen: show it now rather than waiting for the observer.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const Tag = props.as ?? "div";
  return (
    <Tag
      ref={ref as never}
      className={`reveal${shown ? " is-shown" : ""} ${props.className ?? ""}`}
      style={{ "--delay": `${props.delay ?? 0}ms` } as CSSProperties}
    >
      {props.children}
    </Tag>
  );
}

/** A card with a soft light that follows the pointer. */
export function Spotlight(props: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`spotlight ${props.className ?? ""}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--x", `${e.clientX - rect.left}px`);
        el.style.setProperty("--y", `${e.clientY - rect.top}px`);
      }}
    >
      {props.children}
    </div>
  );
}
