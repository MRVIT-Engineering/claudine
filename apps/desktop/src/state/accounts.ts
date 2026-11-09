// The real Claude accounts. Rust keeps the list and runs `claude auth`; this only shows
// what it reports. Sign-in status is asked fresh, never stored.
import { createStore, produce } from "solid-js/store";
import {
  type AuthStatus,
  backend,
  type ClaudeAccount,
  DEFAULT_ACCOUNT,
  describeError,
  isCommandError,
} from "../backend";
import type { AccountColor } from "../types";

export type StatusState = AuthStatus | "checking" | "error";

export interface SignInState {
  account: string;
  /** The link `claude` opened, to copy if the browser didn't open. */
  link: string | null;
  error: string | null;
}

interface AccountsState {
  loaded: boolean;
  list: ClaudeAccount[];
  /** The account new sessions start on. */
  selected: string;
  status: Record<string, StatusState>;
  signIn: SignInState | null;
  /** The last failed action, shown next to the list. */
  error: string | null;
}

const [accounts, setAccounts] = createStore<AccountsState>({
  loaded: false,
  list: [],
  selected: DEFAULT_ACCOUNT,
  status: {},
  signIn: null,
  error: null,
});

export { accounts };

// Each sign-in gets a new number, so a cancelled one's last event is ignored.
let signInGeneration = 0;

function messageFor(error: unknown): string {
  return isCommandError(error) ? describeError(error) : String(error);
}

export function accountById(id: string): ClaudeAccount | undefined {
  return accounts.list.find((a) => a.id === id);
}

export function isSignedIn(id: string): boolean {
  const status = accounts.status[id];
  return typeof status === "object" && status.signedIn;
}

export async function loadAccounts() {
  try {
    const { accounts: list, lastUsed } = await backend.listAccounts();
    const first = !accounts.loaded;
    setAccounts(
      produce((s) => {
        // Start on the account the last session used; keep a later choice if it exists.
        if (first || !list.some((a) => a.id === s.selected)) {
          s.selected = lastUsed;
        }
        s.list = list;
        s.loaded = true;
      }),
    );
    await Promise.all(list.map((a) => refreshStatus(a.id)));
  } catch (error) {
    setAccounts({ loaded: true, error: messageFor(error) });
  }
}

export async function refreshStatus(id: string) {
  setAccounts("status", id, "checking");
  try {
    const status = await backend.accountStatus(id);
    setAccounts("status", id, status);
  } catch {
    setAccounts("status", id, "error");
  }
}

export function selectAccount(id: string) {
  setAccounts("selected", id);
}

/** Adds an account, then starts signing it in. */
export async function addAccount(
  label: string,
  color: AccountColor,
  console: boolean,
): Promise<boolean> {
  try {
    const account = await backend.addAccount(label, color);
    setAccounts(
      produce((s) => {
        s.list.push(account);
        s.status[account.id] = {
          signedIn: false,
          email: null,
          plan: null,
          method: null,
        };
        s.error = null;
      }),
    );
    void startSignIn(account.id, console);
    return true;
  } catch (error) {
    setAccounts("error", messageFor(error));
    return false;
  }
}

export async function updateAccount(
  id: string,
  label: string,
  color: AccountColor,
) {
  try {
    const updated = await backend.updateAccount(id, label, color);
    setAccounts("list", (a) => a.id === id, updated);
  } catch (error) {
    setAccounts("error", messageFor(error));
  }
}

export async function removeAccount(id: string): Promise<boolean> {
  try {
    await backend.removeAccount(id);
    setAccounts(
      produce((s) => {
        s.list = s.list.filter((a) => a.id !== id);
        delete s.status[id];
        if (s.selected === id) s.selected = DEFAULT_ACCOUNT;
        if (s.signIn?.account === id) s.signIn = null;
        s.error = null;
      }),
    );
    return true;
  } catch (error) {
    setAccounts("error", messageFor(error));
    return false;
  }
}

export async function signOut(id: string) {
  try {
    await backend.signOut(id);
  } catch (error) {
    setAccounts("error", messageFor(error));
  }
  await refreshStatus(id);
}

export async function startSignIn(id: string, console = false) {
  const mine = ++signInGeneration;
  setAccounts("signIn", { account: id, link: null, error: null });
  try {
    await backend.signIn(id, console, (event) => {
      if (mine !== signInGeneration) return;
      if (event.kind === "link") {
        setAccounts("signIn", "link", event.url);
      } else if (event.signedIn) {
        setAccounts("signIn", null);
        void refreshStatus(id);
      } else {
        setAccounts(
          "signIn",
          "error",
          event.message ?? "Signing in didn't finish.",
        );
      }
    });
  } catch (error) {
    if (mine === signInGeneration) {
      setAccounts("signIn", "error", messageFor(error));
    }
  }
}

export async function submitSignInCode(code: string): Promise<boolean> {
  try {
    await backend.submitSignInCode(code);
    return true;
  } catch (error) {
    if (accounts.signIn) setAccounts("signIn", "error", messageFor(error));
    return false;
  }
}

export function cancelSignIn() {
  signInGeneration++;
  setAccounts("signIn", null);
  void backend.cancelSignIn().catch(() => {});
}

export function dismissAccountsError() {
  setAccounts("error", null);
}
