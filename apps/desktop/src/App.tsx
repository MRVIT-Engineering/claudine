import { Match, onMount, Show, Switch } from "solid-js";
import { hasBackend } from "./backend";
import { AppBar, StatusBar } from "./components/Chrome";
import { CommandPalette } from "./components/CommandPalette";
import { Dialogs } from "./components/Dialogs";
import { loadRuns } from "./state/runs";
import {
  loadCurrentProject,
  loadSettings,
  settingsReady,
  state,
} from "./state/store";
import { AccountsView } from "./views/Accounts";
import { Agentic } from "./views/Agentic";
import { Editor } from "./views/Editor";
import { Parallel } from "./views/Parallel";
import { SettingsView } from "./views/Settings";
import { Setup } from "./views/Setup";

export function App() {
  // Settings first, so the first paint already has the right theme and layout.
  onMount(async () => {
    await loadSettings();
    await loadCurrentProject();
    // For the Agentic badge, before the view is opened.
    if (hasBackend()) void loadRuns();
  });
  const hasStatusBar = () =>
    state.view === "editor" ||
    state.view === "agentic" ||
    state.view === "parallel";
  return (
    <Show when={settingsReady()}>
      <Show when={state.settings.setupDone} fallback={<Setup />}>
        <div class="app" classList={{ "with-status": hasStatusBar() }}>
          <AppBar />
          <Switch>
            <Match when={state.view === "editor"}>
              <Editor />
            </Match>
            <Match when={state.view === "agentic"}>
              <Agentic />
            </Match>
            <Match when={state.view === "parallel"}>
              <Parallel />
            </Match>
            <Match when={state.view === "accounts"}>
              <AccountsView />
            </Match>
            <Match when={state.view === "settings"}>
              <SettingsView />
            </Match>
          </Switch>
          <Show when={hasStatusBar()}>
            <StatusBar />
          </Show>
        </div>
        <Dialogs />
        <CommandPalette />
      </Show>
    </Show>
  );
}
