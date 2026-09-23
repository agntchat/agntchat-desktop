//! Files the presser asked the app to hand to the OS.

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const MAX_VCARD_BYTES: usize = 64 * 1024;

/// Write a vCard (from a Surface's "Save contact" button) into the Downloads
/// folder and open it with the OS default handler, so Contacts on macOS /
/// Windows offers to add it. The filename is reduced to a plain
/// `<name>.vcf`; the contents are what the renderer built (`src/a2ui/vcard.ts`).
#[tauri::command]
pub fn save_and_open_vcard(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let safe: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '\''))
        .collect();
    let safe = safe.trim().trim_start_matches('.').to_string();
    if safe.is_empty() || !safe.ends_with(".vcf") {
        return Err("invalid vCard filename".into());
    }
    if contents.len() > MAX_VCARD_BYTES || !contents.starts_with("BEGIN:VCARD") {
        return Err("invalid vCard contents".into());
    }

    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();
    // The shell plugin's `open` is what the rest of the app uses for
    // external URLs (src/lib/openExternal.ts); no second opener plugin.
    #[allow(deprecated)]
    app.shell()
        .open(path_str.clone(), None)
        .map_err(|e| e.to_string())?;
    Ok(path_str)
}

/// Hard ceiling on a saved attachment, so a bad URL can't fill the disk.
/// Well above the backend's upload limit; this is a backstop, not a policy.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// Reduce a server-supplied filename to something safe to join onto a
/// directory: no separators, no traversal, no leading dot.
fn safe_download_name(filename: &str) -> String {
    let base = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.');
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
        .collect();
    if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    }
}

/// `report.pdf` → `report (1).pdf` when the name is taken, so a second
/// download never silently overwrites the first.
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..1000 {
        let next = dir.join(format!("{stem} ({n}){ext}"));
        if !next.exists() {
            return next;
        }
    }
    candidate
}

/// Save a signed attachment URL straight into the OS Downloads folder and
/// return the absolute path written.
///
/// The webview can't download on its own — Tauri gives it no download
/// handler, and routing the click to the system browser would make grabbing
/// a file from a chat bounce through Safari/Edge. Fetching here puts the
/// file where the user expects it with one click.
#[tauri::command]
pub async fn download_to_downloads(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("only https downloads are allowed".into());
    }
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;

    // ureq is blocking; keep it off the async runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        let resp = ureq::get(&url).call().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = unique_path(&dir, &safe_download_name(&filename));
        let mut reader = std::io::Read::take(resp.into_reader(), MAX_DOWNLOAD_BYTES);
        let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        std::io::copy(&mut reader, &mut file).map_err(|e| e.to_string())?;
        Ok(dunce::simplified(&path).to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
