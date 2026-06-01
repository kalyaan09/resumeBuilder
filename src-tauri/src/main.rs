// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Only auto-start the sidecar in release builds.
            // In dev mode (`tauri dev`) run `python python/main.py` manually.
            #[cfg(not(debug_assertions))]
            start_sidecar(app)?;
            #[cfg(debug_assertions)]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Spawn the Python sidecar (resume-sidecar binary) and drain its output
/// channel so the pipe buffer never fills up and stalls the process.
#[cfg(not(debug_assertions))]
fn start_sidecar(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_shell::{process::CommandEvent, ShellExt};

    let (mut rx, child) = app
        .shell()
        .sidecar("resume-sidecar")
        .expect("resume-sidecar binary not found; run build-dmg.sh first")
        .spawn()?;

    // Leak the CommandChild handle so the process is not killed if Drop does so.
    // The OS terminates child processes when the Tauri app exits on macOS.
    std::mem::forget(child);

    // Drain stdout/stderr asynchronously, required to prevent the sidecar
    // from blocking on a full pipe buffer.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stderr(line) = event {
                eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
            }
        }
    });

    Ok(())
}
