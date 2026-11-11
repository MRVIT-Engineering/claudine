import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claudine — an editor for Claude Code that asks first",
  description:
    "A small, security-first desktop editor around your own Claude Code. Every edit and command waits for your approval, and the rules live in Rust.",
};

export const viewport: Viewport = {
  themeColor: "#0d0e10",
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    // The class lets the CSS hide scroll reveals only when scripts can show them again.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script>{`document.documentElement.classList.add("js")`}</script>
      </head>
      <body>{props.children}</body>
    </html>
  );
}
