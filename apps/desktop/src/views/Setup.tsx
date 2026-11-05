import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { AccountForm } from "../components/AccountForm";
import { Brand } from "../components/Chrome";
import { AccountBadge } from "../components/Common";
import {
  ArrowRight,
  BoltIcon,
  CheckIcon,
  CloseIcon,
  ColumnsIcon,
  LogoIcon,
  PlusIcon,
  SplitIcon,
} from "../components/Icons";
import {
  finishSetup,
  removeAccount,
  state,
  updateSettings,
} from "../state/store";

const STEPS = ["Welcome", "Theme", "Accounts", "Ready"];

function Feature(props: { icon: JSX.Element; title: string; text: string }) {
  return (
    <div class="feature">
      <span class="feature-icon">{props.icon}</span>
      <strong>{props.title}</strong>
      <span>{props.text}</span>
    </div>
  );
}

function ThemePreview(props: { theme: "dark" | "light" }) {
  return (
    <span class={`theme-preview preview-${props.theme}`} aria-hidden="true">
      <span class="tp-chrome">
        <i />
        <i />
        <i />
      </span>
      <span class="tp-body">
        <span class="tp-side">
          <i />
          <i />
          <i class="on" />
          <i />
        </span>
        <span class="tp-code">
          <span>
            <b>impl</b> <em>Pool</em> {"{"}
          </span>
          <span class="tp-del">- sessions: Vec&lt;S&gt;,</span>
          <span class="tp-add">+ sessions: Vec&lt;Arc&lt;S&gt;&gt;,</span>
          <span class="tp-add">+ limit: Semaphore,</span>
          <span>{"}"}</span>
        </span>
        <span class="tp-chat">
          <i class="block" />
          <i />
          <i class="short" />
          <i class="input" />
        </span>
      </span>
    </span>
  );
}

function ThemeOption(props: { theme: "dark" | "light"; label: string }) {
  const selected = () => state.settings.theme === props.theme;
  return (
    <label class="theme-option" classList={{ selected: selected() }}>
      <ThemePreview theme={props.theme} />
      <span class="theme-radio">
        <input
          type="radio"
          name="setup-theme"
          checked={selected()}
          onChange={() => updateSettings({ theme: props.theme })}
        />
        {props.label}
      </span>
    </label>
  );
}

function Footer(props: {
  note?: string;
  onBack?: () => void;
  children: JSX.Element;
}) {
  return (
    <div class="setup-footer">
      <Show when={props.onBack}>
        <button type="button" class="btn btn-lg" onClick={props.onBack}>
          Back
        </button>
      </Show>
      <Show when={props.note}>
        <span class="muted">{props.note}</span>
      </Show>
      <span class="spacer" />
      {props.children}
    </div>
  );
}

function AccountsStep(props: { onBack: () => void; onNext: () => void }) {
  const [adding, setAdding] = createSignal(false);
  const hasAccount = () => state.accounts.length > 0;
  return (
    <>
      <h1>Connect your Claude accounts</h1>
      <p class="lede">
        Connect at least one. Add more and Claudine can run a session on each of
        them at the same time.
      </p>
      <Show when={hasAccount()}>
        <ul class="connected-list">
          <For each={state.accounts}>
            {(account) => (
              <li>
                <AccountBadge label={account.label} color={account.color} />
                <span>
                  <strong>{account.label}</strong>
                  <small class="muted">{account.email}</small>
                </span>
                <span class="signed-in">
                  <span class="dot dot-running" /> Signed in
                </span>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Remove ${account.label}`}
                  onClick={() => removeAccount(account.id)}
                >
                  <CloseIcon size={13} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show
        when={adding()}
        fallback={
          <button
            type="button"
            class="btn-dashed"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />{" "}
            {hasAccount()
              ? "Connect another account"
              : "Connect a Claude account"}
          </button>
        }
      >
        <AccountForm onDone={() => setAdding(false)} />
      </Show>
      <Footer
        onBack={props.onBack}
        note={hasAccount() ? undefined : "Connect an account to continue."}
      >
        <button
          type="button"
          class="btn btn-lg btn-accent"
          disabled={!hasAccount()}
          onClick={props.onNext}
        >
          Continue
        </button>
      </Footer>
    </>
  );
}

export function Setup() {
  const [step, setStep] = createSignal(0);
  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => s - 1);

  return (
    <div class="setup">
      <header class="appbar">
        <Brand />
        <span class="appbar-right muted">Setup · step {step() + 1} of 4</span>
      </header>
      <main class="setup-main">
        <ol class="stepper">
          <For each={STEPS}>
            {(name, index) => (
              <li classList={{ done: index() <= step() }}>{name}</li>
            )}
          </For>
        </ol>
        <section class="setup-card">
          <Switch>
            <Match when={step() === 0}>
              <span class="hero-mark">
                <LogoIcon size={24} />
              </span>
              <h1>Welcome to Claudine</h1>
              <p class="lede">
                A small, fast editor built around Claude Code. Two quick choices
                and you're ready to work.
              </p>
              <div class="features">
                <Feature
                  icon={<SplitIcon size={18} />}
                  title="Diffs in the editor"
                  text="Review Claude's edits side by side, hunk by hunk."
                />
                <Feature
                  icon={<ColumnsIcon size={18} />}
                  title="Many accounts at once"
                  text="Run sessions on several Claude accounts in parallel."
                />
                <Feature
                  icon={<BoltIcon size={18} />}
                  title="Light and quick"
                  text="Opens instantly and stays out of your way."
                />
              </div>
              <Footer>
                <button
                  type="button"
                  class="btn btn-lg btn-accent"
                  onClick={next}
                >
                  Get started
                </button>
              </Footer>
            </Match>
            <Match when={step() === 1}>
              <h1>Pick a theme</h1>
              <p class="lede">You can switch any time in Settings.</p>
              <div class="theme-options">
                <ThemeOption theme="dark" label="Dark" />
                <ThemeOption theme="light" label="Light" />
              </div>
              <Footer onBack={back} note="Takes effect right away.">
                <button
                  type="button"
                  class="btn btn-lg btn-accent"
                  onClick={next}
                >
                  Continue
                </button>
              </Footer>
            </Match>
            <Match when={step() === 2}>
              <AccountsStep onBack={back} onNext={next} />
            </Match>
            <Match when={step() === 3}>
              <span class="hero-mark success">
                <CheckIcon size={24} />
              </span>
              <h1>You're all set</h1>
              <p class="lede">
                Here's what you chose. Everything can be changed later in
                Settings.
              </p>
              <dl class="summary">
                <div>
                  <dt>Theme</dt>
                  <dd>{state.settings.theme === "dark" ? "Dark" : "Light"}</dd>
                </div>
                <div>
                  <dt>Accounts</dt>
                  <dd class="summary-accounts">
                    <For each={state.accounts}>
                      {(account) => (
                        <span class="summary-chip">
                          <AccountBadge
                            label={account.label}
                            color={account.color}
                            size="sm"
                          />
                          {account.label}
                        </span>
                      )}
                    </For>
                  </dd>
                </div>
              </dl>
              <Footer onBack={back}>
                <button
                  type="button"
                  class="btn btn-lg btn-accent"
                  onClick={finishSetup}
                >
                  Open Claudine <ArrowRight />
                </button>
              </Footer>
            </Match>
          </Switch>
        </section>
      </main>
    </div>
  );
}
