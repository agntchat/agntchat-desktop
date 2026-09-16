import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initDesignSystemDebug } from "./lib/designSystemDebug";
import { installExternalLinkHandler } from "./lib/openExternal";
// Side-effect: initialize i18next (reads the persisted locale preference
// synchronously) before anything renders.
import "./i18n";
import "./styles.css";

initDesignSystemDebug();
// External <a href> clicks (message links, result cards, file cards) must go
// through the shell plugin — the webview has no browser to open them in.
installExternalLinkHandler();

// Catch unhandled promise rejections (async errors outside React)
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Unhandled Rejection]", event.reason);
  event.preventDefault(); // Prevent crash
});

window.addEventListener("error", (event) => {
  console.error("[Uncaught Error]", event.error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
