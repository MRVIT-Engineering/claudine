import { Match, Show, Switch } from "solid-js";
import { AppBar, StatusBar } from "./components/Chrome";
import { Dialogs } from "./components/Dialogs";
import { state } from "./state/store";
import { AccountsView } from "./views/Accounts";
import { Editor } from "./views/Editor";
import { Parallel } from "./views/Parallel";
import { SettingsView } from "./views/Settings";
import { Setup } from "./views/Setup";

export function App() {
  const hasStatusBar = () =>
    state.view === "editor" || state.view === "parallel";
  return (
    <Show when={state.setupDone} fallback={<Setup />}>
      <div class="app" classList={{ "with-status": hasStatusBar() }}>
        <AppBar />
        <Switch>
          <Match when={state.view === "editor"}>
            <Editor />
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
    </Show>
  );
}
