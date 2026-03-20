use tauri::Manager;

#[cfg(feature = "native-core")]
mod native_render;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(feature = "native-core")]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            torus_bridge::commands::native_init,
            torus_bridge::commands::native_step,
            torus_bridge::commands::native_get_state,
            torus_bridge::commands::native_get_diagnostics,
            torus_bridge::commands::native_update_params,
            torus_bridge::commands::native_backend_info,
            torus_bridge::commands::native_update_camera,
        ]);

    #[cfg(not(feature = "native-core"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Native render: initialize wgpu surface on main window
            #[cfg(feature = "native-core")]
            {
                if let Err(e) = native_render::init_native_render(app) {
                    log::warn!("Native render init failed, falling back to WebView: {}", e);
                }
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(4000));

                if let Some(splash) = handle.get_webview_window("splash") {
                    let _ = splash.eval("document.body.classList.add('fade-out')");
                    std::thread::sleep(std::time::Duration::from_millis(600));
                    let _ = splash.close();
                }
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.show();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
