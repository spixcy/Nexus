use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

fn api_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("nexus-voice", "openai-api-key").map_err(|e| e.to_string())
}

#[tauri::command]
fn provider_key_saved() -> bool {
    api_key_entry().and_then(|entry| entry.get_password().map_err(|e| e.to_string())).is_ok()
}

#[tauri::command]
fn save_provider_key(api_key: String) -> Result<bool, String> {
    let entry = api_key_entry()?;
    if api_key.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) => Ok(false),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(error.to_string()),
        }
    } else {
        entry.set_password(api_key.trim()).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
async fn transcribe_audio(audio: Vec<u8>, mime_type: String) -> Result<String, String> {
    if audio.is_empty() || audio.len() > 25 * 1024 * 1024 { return Err("Recording must be between 1 byte and 25 MB.".into()); }
    let entry = api_key_entry()?;
    let key = entry.get_password().map_err(|_| "Add an OpenAI API key in Settings to transcribe voice.".to_string())?;
    let mime = mime_type.split(';').next().unwrap_or("audio/webm");
    let extension = match mime {
        "audio/webm" => "webm", "audio/mp4" => "mp4", "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav", "audio/mpeg" => "mp3",
        _ => return Err(format!("Unsupported recording format: {mime}")),
    };
    let file = reqwest::multipart::Part::bytes(audio).file_name(format!("nexus-recording.{extension}")).mime_str(mime).map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("model", "gpt-transcribe").part("file", file);
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(key)
        .multipart(form)
        .send().await.map_err(|e| format!("Transcription request failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"]["message"].as_str().map(str::to_string)).unwrap_or(body);
        return Err(format!("Transcription failed ({status}): {detail}"));
    }
    serde_json::from_str::<Value>(&body).ok().and_then(|v| v["text"].as_str().map(str::trim).map(str::to_string)).filter(|text| !text.is_empty()).ok_or("Transcription returned no text.".into())
}

#[derive(Default)]
struct CodexState(Mutex<Option<Arc<CodexClient>>>);

struct CodexClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, Sender<Value>>>>,
    next_id: AtomicU64,
}

impl Drop for CodexClient {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl CodexClient {
    fn start(app: AppHandle) -> Result<Self, String> {
        let mut child = Command::new("codex")
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start Codex app-server. Install Codex CLI and sign in first: {e}"))?;
        let stdin = child.stdin.take().ok_or("Codex app-server stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Codex app-server stdout unavailable")?;
        let pending = Arc::new(Mutex::new(HashMap::<u64, Sender<Value>>::new()));
        let pending_reader = Arc::clone(&pending);

        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(id) = message.get("id") {
                    if let Some(method) = message.get("method").and_then(Value::as_str) {
                        if matches!(method, "item/commandExecution/requestApproval" | "item/fileChange/requestApproval") {
                            let _ = app.emit("codex-request", message);
                        } else {
                            let _ = app.emit("codex-event", json!({
                                "method": "nexus/unsupportedApproval",
                                "params": {"method": method}
                            }));
                        }
                    } else if let Some(number) = id.as_u64() {
                        if let Some(tx) = pending_reader.lock().ok().and_then(|mut p| p.remove(&number)) {
                            let _ = tx.send(message);
                        }
                    }
                } else if message.get("method").is_some() {
                    let _ = app.emit("codex-event", message);
                }
            }
            let _ = app.emit("codex-status", json!({"connected": false, "error": "Codex app-server closed its output."}));
        });

        Ok(Self { child: Mutex::new(child), stdin: Mutex::new(stdin), pending, next_id: AtomicU64::new(1) })
    }

    fn send(&self, message: &Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().map_err(|_| "Codex input is unavailable".to_string())?;
        serde_json::to_writer(&mut *stdin, message).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").and_then(|_| stdin.flush()).map_err(|e| e.to_string())
    }

    fn notify(&self, method: &str) -> Result<(), String> {
        self.send(&json!({"jsonrpc":"2.0", "method":method, "params":{}}))
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(|_| "Codex response queue is unavailable".to_string())?.insert(id, tx);
        if let Err(error) = self.send(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params})) {
            self.pending.lock().ok().and_then(|mut pending| pending.remove(&id));
            return Err(error);
        }
        match rx.recv_timeout(Duration::from_secs(45)) {
            Ok(response) if response.get("error").is_some() => Err(response["error"]["message"].as_str().unwrap_or("Codex request failed").to_string()),
            Ok(response) => Ok(response.get("result").cloned().unwrap_or(Value::Null)),
            Err(RecvTimeoutError::Timeout) => {
                self.pending.lock().ok().and_then(|mut pending| pending.remove(&id));
                Err(format!("Timed out waiting for Codex {method}"))
            }
            Err(_) => Err("Codex app-server stopped responding".to_string()),
        }
    }
}

#[tauri::command]
async fn connect_codex(app: AppHandle, state: State<'_, CodexState>, cwd: String, thread_id: Option<String>) -> Result<Value, String> {
    let folder = Path::new(&cwd);
    if !folder.is_dir() { return Err("Choose an existing local project folder first.".into()); }
    let cwd = folder.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().to_string();
    let client = Arc::new(CodexClient::start(app.clone())?);

    let handshake = client.request("initialize", json!({
        "clientInfo": {"name":"nexus_voice", "title":"NEXUS Voice", "version":"0.1.0"},
        "capabilities": {"experimentalApi": false}
    }))?;
    let _ = handshake;
    client.notify("initialized")?;

    let thread = if let Some(id) = thread_id.filter(|id| !id.is_empty()) {
        client.request("thread/resume", json!({"threadId":id}))?
    } else {
        client.request("thread/start", json!({"cwd":cwd, "approvalPolicy":"on-request", "sandbox":"workspace-write"}))?
    };
    let id = thread["thread"]["id"].as_str().ok_or("Codex did not return a thread id")?.to_string();
    *state.0.lock().map_err(|_| "Codex state is unavailable".to_string())? = Some(client);
    app.emit("codex-status", json!({"connected":true,"threadId":id,"cwd":cwd})).map_err(|e| e.to_string())?;
    Ok(json!({"threadId":id,"cwd":cwd}))
}

#[tauri::command]
fn send_codex_prompt(state: State<'_, CodexState>, thread_id: String, prompt: String) -> Result<Value, String> {
    if prompt.trim().is_empty() { return Err("Prompt cannot be empty.".into()); }
    let client = state.0.lock().map_err(|_| "Codex state is unavailable".to_string())?.clone().ok_or("Connect Codex before sending a prompt.")?;
    client.request("turn/start", json!({"threadId":thread_id,"input":[{"type":"text","text":prompt}]}))
}

#[tauri::command]
fn interrupt_codex_turn(state: State<'_, CodexState>, thread_id: String, turn_id: String) -> Result<Value, String> {
    let client = state.0.lock().map_err(|_| "Codex state is unavailable".to_string())?.clone().ok_or("Codex is not connected.")?;
    client.request("turn/interrupt", json!({"threadId":thread_id,"turnId":turn_id}))
}

#[tauri::command]
fn respond_codex_approval(state: State<'_, CodexState>, request_id: Value, decision: String) -> Result<(), String> {
    if !["accept", "decline", "cancel", "acceptForSession"].contains(&decision.as_str()) {
        return Err("Unsupported approval decision.".into());
    }
    let client = state.0.lock().map_err(|_| "Codex state is unavailable".to_string())?.clone().ok_or("Codex is not connected.")?;
    client.send(&json!({"jsonrpc":"2.0","id":request_id,"result":{"decision":decision}}))
}

#[tauri::command]
fn disconnect_codex(state: State<'_, CodexState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Codex state is unavailable".to_string())? = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CodexState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![connect_codex, send_codex_prompt, interrupt_codex_turn, respond_codex_approval, disconnect_codex, provider_key_saved, save_provider_key, transcribe_audio])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS Voice");
}
