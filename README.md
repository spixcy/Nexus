# NEXUS Voice

NEXUS Voice is a Windows desktop developer workspace built with Tauri 2, React, TypeScript and Rust. Its cinematic background uses the supplied `video_unpack_loop.mov` asset.

## Run

Install Node.js, Rust, the Microsoft C++ build tools and WebView2, then run:

```powershell
npm install
npm run tauri dev
```

Create a Windows installer with `npm run tauri build`.

## Current features

- Responsive dashboard with Overview, Projects, Tasks, History and Settings.
- Native folder picker; the selected project path stays on this device.
- Editable prompt review with the original request shown separately. Nothing starts before **Send to Codex**.
- Push-to-talk by holding the voice control or `Ctrl+Shift+Space`. The app records in WebView2 and sends the audio to OpenAI's `/v1/audio/transcriptions` endpoint using `gpt-transcribe` after recording stops.
- The OpenAI API key is stored in Windows Credential Manager. Transcription uses the user's own API billing. Offline speech recognition is not implemented.
- Short completion and approval announcements use the Windows/WebView2 speech synthesis voice. Voice selection and full spoken conversations are not implemented.
- Codex sessions use `codex app-server --listen stdio://` with the local CLI's existing sign-in. NEXUS sends a prompt only after review, streams agent message deltas, supports interrupts, and relays command/file-change approvals.

## Codex setup

Install the Codex CLI, sign in with `codex login`, select a local project in NEXUS, then choose **Connect Codex**. Codex runs in the selected folder with the `workspace-write` sandbox and `on-request` approval policy. NEXUS does not expose arbitrary shell execution. Only the standard command execution and file change approval dialogs are currently handled in the UI; other interactive request types need a dedicated review view.

NEXUS uses the documented local app-server JSON-RPC interface over stdio. It does not implement Sign in with ChatGPT OAuth; use the Codex CLI's supported local authentication. The OpenAI API key setting is used for voice transcription, not Codex task execution.

## Checks

```powershell
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
```
