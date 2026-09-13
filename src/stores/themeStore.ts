import { create } from "zustand";

const STORAGE_KEY = "agentchat:theme";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Tauri's webview honors this for the native scrollbar + form controls
  document.documentElement.style.colorScheme = theme;
}

// Light and dark are the only two states — there is no "follow the OS" mode.
// The OS preference is read exactly once, to pick the first-run default;
// after that the stored choice is authoritative and never re-resolved.
const stored = localStorage.getItem(STORAGE_KEY);
const initialTheme: Theme =
  stored === "light" || stored === "dark"
    ? stored
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
applyTheme(initialTheme);
localStorage.setItem(STORAGE_KEY, initialTheme);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
