mod files;
mod process_manager;

use process_manager::ProcessManager;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Self-update: the frontend drives the check/download/install so the
        // user sees a toast rather than a blocking dialog (src/lib/updater.ts).
        // `process` is what lets it relaunch into the new build after install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let manager = ProcessManager::new();
            app.manage(Mutex::new(manager));

            // The title bar carries the running version, so "which build are
            // you on?" is answerable without a trip into Profile > About.
            // Appended at runtime from the bundle version rather than baked
            // into tauri.conf.json's static `title`, so `npm run bump` stays
            // the only place a version number is ever edited.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!(
                    "agntchat (Beta) - {}",
                    app.package_info().version
                ));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            process_manager::start_agent,
            process_manager::stop_agent,
            process_manager::get_agent_status,
            process_manager::get_all_statuses,
            process_manager::get_agent_logs,
            process_manager::get_device_name,
            process_manager::get_bridge_paths,
            process_manager::list_claude_sessions,
            process_manager::bind_claude_session,
            process_manager::launch_claude_session,
            process_manager::launch_claude_session_background,
            process_manager::resume_claude_session_background,
            process_manager::attach_claude_session_terminal,
            process_manager::background_session_available,
            process_manager::rekey_external_agent,
            process_manager::list_external_identities,
            process_manager::check_computer_use_deps,
            process_manager::install_computer_use_deps,
            process_manager::get_computer_use_deps_status,
            process_manager::open_claude_login,
            files::save_and_open_vcard,
            files::download_to_downloads,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill all managed bridge processes when the app window closes
                if let Some(state) = window.try_state::<Mutex<ProcessManager>>() {
                    if let Ok(mut manager) = state.lock() {
                        eprintln!("[ProcessManager] App closing — killing all bridge processes");
                        manager.kill_all();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
