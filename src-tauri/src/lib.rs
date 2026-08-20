use keyring::Entry;

/// The desktop build keeps the key in the OS credential store rather than in
/// `localStorage`, which any script on the origin can read.
const KEYCHAIN_SERVICE: &str = "com.bendrucker.anthropic-text-editor-inspector";
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
  Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_api_key() -> Option<String> {
  entry().ok()?.get_password().ok()
}

#[tauri::command]
fn write_api_key(key: String) -> Result<(), String> {
  entry()?.set_password(&key).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_api_key() -> Result<(), String> {
  match entry()?.delete_credential() {
    // Having nothing stored is not a failure to clear.
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Requests leave from Rust, so the API never sees a browser origin. That is
    // what lets an organization with custom retention settings use this build.
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![
      read_api_key,
      write_api_key,
      clear_api_key
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
