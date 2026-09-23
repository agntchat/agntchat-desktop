import { invoke } from "@tauri-apps/api/core";
import { getFileDownloadUrl } from "./api";
import { openExternal } from "./openExternal";

/**
 * Turn a signed storage URL into one that answers with
 * `Content-Disposition: attachment` — Supabase Storage honours a `download`
 * query param on signed object URLs (an empty value keeps the object's own
 * name). Only matters for the browser fallback below; the native save path
 * writes the bytes itself.
 */
export function asDownloadUrl(url: string, filename?: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", filename ?? "");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Save an attachment into the OS Downloads folder.
 *
 * The webview has no download handler of its own, so an `<a download>` here
 * is a dead end (and `installExternalLinkHandler` would hijack it into the
 * system browser anyway). The Rust side fetches the URL and writes the file;
 * if that fails we fall back to handing the browser a download-flavoured URL
 * rather than leaving the click dead.
 *
 * The signed URL is resolved FRESH on every call — the ones embedded in
 * message payloads are signed at serialize time and expire in minutes.
 */
export async function downloadAttachment(
  attachmentId: string,
  filename?: string
): Promise<string | null> {
  const { url } = await getFileDownloadUrl(attachmentId);

  try {
    return await invoke<string>("download_to_downloads", {
      url,
      filename: filename ?? "",
    });
  } catch (e) {
    console.warn("[downloadAttachment] native save failed, opening externally", e);
    openExternal(asDownloadUrl(url, filename));
    return null;
  }
}
