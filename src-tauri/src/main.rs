// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

/// Sidecar child handle, killed on app exit.
static SIDECAR_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            start_sidecar(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_sidecar();
            }
        });
}

fn kill_sidecar() {
    if let Ok(mut guard) = SIDECAR_CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Kill any sidecar left over from a previous run (crash, force-quit) so it
/// can't hold the port and serve stale code.
fn kill_orphaned_sidecars() {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "resume-sidecar"])
            .status();
    }
}

/// Spawn the Python sidecar from the app's bundled Resources/sidecar/ directory.
/// --onedir output: no extraction needed, starts in ~1-2s on any launch.
fn start_sidecar(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Stdio;
    use tauri::Manager;

    kill_orphaned_sidecars();

    let resource_dir = app.path().resource_dir()?;
    let sidecar_path = resource_dir.join("resources").join("sidecar").join("resume-sidecar");

    // Ensure executable bit is set (Tauri bundler may strip it).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&sidecar_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&sidecar_path, perms);
        }
    }

    // Append stdout + stderr to ~/.resume-editor/sidecar.log for debugging.
    // Append (not truncate): a second spawn must not wipe the live sidecar's log.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let log_dir = std::path::Path::new(&home).join(".resume-editor");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("sidecar.log");
    let open_log = || {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map(Stdio::from)
            .unwrap_or(Stdio::null())
    };

    let child = std::process::Command::new(&sidecar_path)
        .stdout(open_log())
        .stderr(open_log())
        .spawn()?;

    if let Ok(mut guard) = SIDECAR_CHILD.lock() {
        *guard = Some(child);
    }

    Ok(())
}
