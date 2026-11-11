"use client";
// Several Claude Code accounts, signed in side by side: the picker in the chat input
// steps through them. A timer drives it; with reduced motion it rests on the first.
import { type CSSProperties, useEffect, useState } from "react";

export const ACCOUNTS = [
  { id: "W", label: "Work", plan: "Team", color: "#c07afd" },
  { id: "P", label: "Personal", plan: "Max", color: "#cc7c5e" },
  { id: "C", label: "Client", plan: "Pro", color: "#7cc79a" },
];

export function AccountBadge(props: { index: number; size?: number }) {
  const account = ACCOUNTS[props.index % ACCOUNTS.length];
  if (!account) return null;
  return (
    <span
      className="acct-badge"
      style={
        {
          "--c": account.color,
          "--s": `${props.size ?? 22}px`,
        } as CSSProperties
      }
    >
      {account.id}
    </span>
  );
}

export function Accounts() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () => setActive((a) => (a + 1) % ACCOUNTS.length),
      1800,
    );
    return () => clearInterval(timer);
  }, []);
  const current = ACCOUNTS[active];

  return (
    <div className="acct" aria-hidden="true">
      <div className="acct-list">
        <div className="acct-list-head">Signed in</div>
        {ACCOUNTS.map((account, i) => (
          <div
            key={account.id}
            className={`acct-row${i === active ? " is-active" : ""}`}
          >
            <AccountBadge index={i} />
            <span className="acct-name">{account.label}</span>
            <span className="acct-plan">{account.plan}</span>
            <span className="acct-ok" />
          </div>
        ))}
      </div>
      <div className="acct-chat">
        <div className="acct-input">
          <span className="placeholder">Ask Claude…</span>
          <div className="acct-pickers">
            <span
              key={active}
              className="acct-picker pop"
              style={{ "--c": current?.color } as CSSProperties}
            >
              <span className="acct-picker-dot" />
              {current?.label}
              <span className="acct-caret">▾</span>
            </span>
            <span className="acct-picker is-plain">Opus</span>
            <span className="w-send" />
          </div>
        </div>
      </div>
    </div>
  );
}
