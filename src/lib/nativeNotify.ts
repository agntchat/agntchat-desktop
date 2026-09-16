import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import * as api from "./api";

/** Raise a native OS notification when the app window isn't focused, gated
 *  on the given notification-preference category (`GET
 *  /api/me/notification-preferences`). Shared by every feature that raises
 *  a background notification (date reminders, new messages/mentions) so
 *  they all respect the same focus/permission flow instead of each
 *  reimplementing it. */
export async function notifyIfEnabled(
  category: string,
  notification: { title: string; body: string }
) {
  try {
    if (await getCurrentWindow().isFocused()) return;

    const enabled = await api
      .request<{ notificationPreferences: Record<string, boolean> }>(
        "/api/me/notification-preferences"
      )
      .then((data) => data.notificationPreferences[category] !== false)
      // Fail CLOSED: if we can't read the preference, stay quiet. A missed
      // notification is recoverable (the message is still in the app); a
      // notification the user explicitly switched off is not.
      .catch(() => false);
    if (!enabled) return;

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;

    sendNotification(notification);
  } catch {
    // Notification plugin unavailable (e.g. running in a plain browser dev
    // server) — the in-app toast/UI still covers it.
  }
}
