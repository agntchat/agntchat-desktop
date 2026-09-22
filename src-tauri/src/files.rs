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
