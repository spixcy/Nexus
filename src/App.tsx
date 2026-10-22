import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import backgroundVideo from "../video_unpack_loop.mov?url";
import "./App.css";

type Page = "Overview" | "Projects" | "Tasks" | "History" | "Settings";
type IconName = "overview" | "projects" | "tasks" | "history" | "settings" | "plus" | "mic" | "send" | "arrow" | "close" | "check" | "folder" | "spark" | "key";
type CodexMessage = { method: string; params?: Record<string, unknown> };
type ApprovalRequest = { id: string | number; method: string; params?: Record<string, unknown> };

const paths: Record<IconName, string> = {
  overview: "M3 3h7v7H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 14h7v7H3z",
  projects: "M3 6h7l2 2h9v11H3z M3 6V4h7l2 2",
  tasks: "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01",
  history: "M3 12a9 9 0 1 0 2.64-6.36L3 8 M3 3v5h5 M12 7v5l3 2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.75.65l-.04.07h-3.4l-.04-.07a1.7 1.7 0 0 0-1.75-.65l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.6 15l-.07-.04v-3.4l.07-.04a1.7 1.7 0 0 0 .65-1.75l-.02-.08 2.94-1.7.06.06a1.7 1.7 0 0 0 1.88.34l.04-.07h3.4l.04.07a1.7 1.7 0 0 0 1.75.65l.08-.02 1.7 2.94-.06.06A1.7 1.7 0 0 0 21.4 14l-.07.04v3.4z",
  plus: "M12 5v14 M5 12h14",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3 M8 22h8",
  send: "m22 2-7 20-4-9-9-4 20-7z M22 2 11 13",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  close: "M18 6 6 18 M6 6l12 12",
  check: "m5 12 4 4L19 6",
  folder: "M3 6h7l2 2h9v11H3z",
  spark: "m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z",
  key: "M21 2l-2 2m-7.6 7.6a5 5 0 1 1-7.07 7.07 5 5 0 0 1 7.07-7.07zM15 8l3 3m-1-5 3 3",
};

const desktopRuntime = isTauri();

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [projectPath, setProjectPath] = useState(() => localStorage.getItem("nexus-project-path") ?? "");
  const projectParts = projectPath.split(/[\\/]/).filter(Boolean);
  const project = projectPath ? projectParts[projectParts.length - 1] || projectPath : "Select a project";
  const [command, setCommand] = useState("");
  const [draft, setDraft] = useState("");
  const [reviewOriginal, setReviewOriginal] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [threadId, setThreadId] = useState(() => localStorage.getItem("nexus-codex-thread") ?? "");
  const [codexConnected, setCodexConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState("");
  const [agentText, setAgentText] = useState("");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [codexError, setCodexError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRequested = useRef(false);
  const [saved, setSaved] = useState(false);
  const [spokenUpdates, setSpokenUpdates] = useState(() => localStorage.getItem("nexus-spoken-updates") !== "false");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => { if (desktopRuntime) void invoke<boolean>("provider_key_saved").then(setApiKeySaved).catch(() => {}); }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !event.ctrlKey || !event.shiftKey || event.repeat) return;
      event.preventDefault();
      void startRecording();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.ctrlKey && event.shiftKey) stopRecording();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  useEffect(() => {
    if (!desktopRuntime) return;
    let mounted = true;
    let stopListening: (() => void)[] = [];
    void Promise.all([
      listen<CodexMessage>("codex-event", event => {
        const { method, params = {} } = event.payload;
        if (method === "nexus/unsupportedApproval") {
          setCodexError(`Codex requested an interaction NEXUS does not support yet: ${String(params.method)}. The request was left pending.`);
          setToast("Codex requested an unsupported interaction. See Tasks for details.");
          return;
        }
        if (method === "turn/started") {
          const turn = params.turn as { id?: string } | undefined;
          if (turn?.id) setActiveTurnId(turn.id);
          setRunning(true);
        }
        if (method === "item/agentMessage/delta") {
          const delta = params.delta;
          if (typeof delta === "string") setAgentText(text => text + delta);
        }
        if (method === "turn/completed") {
          const turn = params.turn as { id?: string; status?: string } | undefined;
          setRunning(false);
          if (turn?.id) setActiveTurnId(turn.id);
          setToast(turn?.status === "completed" ? "Codex completed this task" : `Codex turn ${turn?.status ?? "ended"}`);
          announce(turn?.status === "completed" ? "Codex finished the task." : `Codex task ${turn?.status ?? "ended"}.`);
        }
      }),
      listen<ApprovalRequest>("codex-request", event => {
        setApproval(event.payload);
        announce("Codex is waiting for your approval.");
      }),
      listen<{ connected: boolean; error?: string; threadId?: string }>("codex-status", event => {
        setCodexConnected(event.payload.connected);
        if (event.payload.threadId) setThreadId(event.payload.threadId);
        if (event.payload.error) setCodexError(event.payload.error);
      }),
    ]).then(listeners => {
      if (mounted) stopListening = listeners;
      else listeners.forEach(stop => stop());
    });
    return () => { mounted = false; stopListening.forEach(stop => stop()); };
  }, [spokenUpdates]);

  function reviewPrompt() {
    if (!command.trim()) return;
    const request = command.trim();
    setReviewOriginal(request);
    setDraft(`Work in the selected project: ${projectPath || "(no project selected)"}.\n\nObjective\n${request}\n\nGuidance\n- Inspect the relevant code and existing conventions before making changes.\n- Make the smallest complete change that meets the objective.\n- Run the relevant checks and report the results, changed files, and any remaining limitations.`);
    setReviewOpen(true);
  }

  function announce(message: string) {
    if (!spokenUpdates || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
  }

  function saveSettings() {
    if (!desktopRuntime) { setToast("Provider settings are available in the Windows desktop app."); return; }
    void invoke<boolean>("save_provider_key", { apiKey }).then(hasKey => {
      setApiKeySaved(hasKey);
      setApiKey("");
      setSaved(true);
      setToast(hasKey ? "API key saved to Windows Credential Manager" : "API key removed from Windows Credential Manager");
      window.setTimeout(() => setSaved(false), 1800);
    }).catch(error => setToast(String(error)));
  }

  async function pickProject() {
    if (!desktopRuntime) { setToast("Local folder access is available in the Windows desktop app."); return; }
    try {
      const path = await open({ directory: true, multiple: false, title: "Choose a project repository" });
      if (typeof path !== "string") return;
      localStorage.setItem("nexus-project-path", path);
      setProjectPath(path);
      setToast("Local project selected");
      setPage("Overview");
    } catch (error) {
      setToast(`Could not open the folder picker: ${String(error)}`);
    }
  }

  async function connectCodex() {
    if (!desktopRuntime) { setToast("Codex sessions are available in the Windows desktop app."); return; }
    if (codexConnected) { setPage("Tasks"); setToast("Codex is already connected and ready for a reviewed prompt."); return; }
    if (!projectPath) { setToast("Select a local project first."); setPage("Projects"); return; }
    setConnecting(true);
    setCodexError("");
    try {
      const connected = await invoke<{ threadId: string }>("connect_codex", { cwd: projectPath, threadId: threadId || null });
      setThreadId(connected.threadId);
      localStorage.setItem("nexus-codex-thread", connected.threadId);
      setCodexConnected(true);
      setToast("Codex connected. Your session is ready.");
    } catch (error) {
      setCodexError(String(error));
      setToast(String(error));
    } finally { setConnecting(false); }
  }

  async function sendToCodex() {
    if (!desktopRuntime) { setToast("Codex sessions are available in the Windows desktop app."); return; }
    if (!codexConnected || !threadId) { setToast("Connect Codex before sending this prompt."); return; }
    try {
      const result = await invoke<{ turn?: { id?: string } }>("send_codex_prompt", { threadId, prompt: draft });
      setActiveTurnId(result.turn?.id ?? "");
      setAgentText("");
      setRunning(true);
      setReviewOpen(false);
      setPage("Tasks");
      setToast("Codex accepted the turn. Listening for live progress.");
    } catch (error) { setToast(String(error)); }
  }

  async function interruptCodex() {
    if (!threadId || !activeTurnId) return;
    try { await invoke("interrupt_codex_turn", { threadId, turnId: activeTurnId }); setToast("Interrupt requested"); }
    catch (error) { setToast(String(error)); }
  }

  async function respondToApproval(decision: "accept" | "decline") {
    if (!approval) return;
    try {
      await invoke("respond_codex_approval", { requestId: approval.id, decision });
      setApproval(null);
      setToast(decision === "accept" ? "Approval sent to Codex" : "Request declined");
    } catch (error) { setToast(String(error)); }
  }

  async function startRecording() {
    if (!desktopRuntime) { setToast("Push-to-talk is available in the Windows desktop app."); return; }
    if (recordingRequested.current || recording || transcribing) return;
    if (!apiKeySaved) { setToast("Save an OpenAI API key in Settings to transcribe voice."); setPage("Settings"); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setToast("Microphone recording is not supported on this device."); return; }
    recordingRequested.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (!recordingRequested.current) { stream.getTracks().forEach(track => track.stop()); streamRef.current = null; return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (!blob.size) { setToast("No audio was recorded."); return; }
        setTranscribing(true);
        try {
          const audio = Array.from(new Uint8Array(await blob.arrayBuffer()));
          const transcript = await invoke<string>("transcribe_audio", { audio, mimeType: blob.type });
          setCommand(value => [value.trim(), transcript].filter(Boolean).join(" "));
          setToast("Transcript added to your draft. Review it before sending.");
        } catch (error) { setToast(String(error)); }
        finally { setTranscribing(false); }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setToast("Listening… release the button or Ctrl+Shift+Space to transcribe.");
    } catch (error) {
      recordingRequested.current = false;
      setToast(`Microphone access failed: ${String(error)}`);
    }
  }

  function stopRecording() {
    recordingRequested.current = false;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  const pages: { name: Page; icon: IconName }[] = [
    { name: "Overview", icon: "overview" },
    { name: "Projects", icon: "projects" },
    { name: "Tasks", icon: "tasks" },
    { name: "History", icon: "history" },
  ];

  return (
    <main className="app-shell">
      <video className="cinematic-bg" src={backgroundVideo} autoPlay muted loop playsInline aria-hidden="true" />
      <div className="ambient-shade" />
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => setPage("Overview")} aria-label="NEXUS Voice overview">
          <span className="brand-mark"><span /></span>
          <span><strong>NEXUS</strong><small>VOICE INTERFACE</small></span>
        </button>
        <div className="side-section-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Workspace navigation">
          {pages.map(item => <button key={item.name} className={`nav-item ${page === item.name ? "active" : ""}`} onClick={() => setPage(item.name)}><Icon name={item.icon} /><span>{item.name}</span>{item.name === "Tasks" && <span className="nav-count">0</span>}</button>)}
        </nav>
        <div className="project-mini-head"><span className="side-section-label">CURRENT PROJECT</span><button className="icon-button tiny" onClick={() => setPage("Projects")} aria-label="Choose project"><Icon name="plus" size={15} /></button></div>
        <button className="project-chip" onClick={() => setPage("Projects")}><span className="project-dot" /><span>{project}</span><span className="project-chevron">⌄</span></button>
        <div className="sidebar-spacer" />
        <div className="provider-card">
          <div className="provider-top"><span className="status-led" /><span>AI PROVIDER</span><span className="provider-state">{apiKeySaved ? "READY" : "SETUP"}</span></div>
          <p>{apiKeySaved ? "OpenAI API key saved" : "Connect a provider to begin"}</p>
          <button onClick={() => setPage("Settings")}>{apiKeySaved ? "Manage connection" : "Configure provider"}<Icon name="arrow" size={14} /></button>
        </div>
        <button className={`nav-item settings-link ${page === "Settings" ? "active" : ""}`} onClick={() => setPage("Settings")}><Icon name="settings" /><span>Settings</span></button>
        <div className="sidebar-footer"><span className="avatar">N</span><span className="user-label"><strong>LOCAL SESSION</strong><small>Desktop workspace</small></span><span className="online-dot" /></div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{page}</strong></div>
          <div className="topbar-right"><button className={`connection-pill ${codexConnected ? "connected" : ""}`} onClick={() => setPage("Tasks")}><i /> {codexConnected ? "Codex connected" : "Codex not connected"}</button><span className="top-divider" /><span className="clock-label">LOCAL · WINDOWS</span><button className="top-shortcut" onClick={() => setPage("Settings")} aria-label="Open settings"><Icon name="settings" size={17} /></button></div>
        </header>

        {!desktopRuntime && <div className="web-preview-notice">WEB PREVIEW · Local folders, push-to-talk, Windows key storage, and Codex execution are available in the desktop app.</div>}

        {page === "Overview" && <section className="overview-page">
          <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> PERSONAL DEVELOPER COMMAND CENTER</div><h1>Good to have you back<span className="cyan-dot">.</span></h1><p>Speak an intention. NEXUS shapes it into work you can review and direct.</p></div><div className="date-chip"><span className="date-icon">✳</span><span>YOUR WORKSPACE<small>LOCAL & PRIVATE</small></span></div></div>

          <div className="hero-grid">
            <section className="core-card">
              <div className="card-grid" />
              <div className="core-card-head"><div><span className="eyebrow">NEXUS CORE</span><h2>{recording ? "Listening" : transcribing ? "Transcribing" : running ? "Codex working" : "Standing by"}<span>.</span></h2></div><span className={`state-badge ${recording || transcribing || running ? "state-active" : ""}`}><i /> {recording ? "LISTENING" : transcribing ? "TRANSCRIBING" : running ? "WORKING" : "IDLE"}</span></div>
              <div className="core-visual" aria-label="NEXUS triangular core standing by">
                <div className="core-orbit orbit-one" /><div className="core-orbit orbit-two" /><div className="core-orbit orbit-three" />
                <div className="core-glow" /><svg className="triangle-core" viewBox="0 0 240 220" role="img" aria-label="Cyan and orange triangular AI core"><defs><linearGradient id="triCyan" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#80ffff"/><stop offset="1" stopColor="#00b8dc"/></linearGradient><linearGradient id="triOrange" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffd18a"/><stop offset="1" stopColor="#ff761f"/></linearGradient><filter id="coreGlow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M120 20 216 190H24Z" fill="none" stroke="url(#triCyan)" strokeWidth="3" filter="url(#coreGlow)"/><path d="m120 52 67 118H53Z" fill="rgba(0,201,226,.06)" stroke="url(#triOrange)" strokeWidth="1.5"/><path d="m120 76 43 75H77Z" fill="none" stroke="rgba(140,255,255,.55)" strokeWidth="1"/><circle cx="120" cy="124" r="13" fill="#69f8ff" opacity=".85"/><circle cx="120" cy="124" r="29" fill="none" stroke="#40eaf7" strokeOpacity=".5"/><path d="M120 95v-25M95 138l-20 12m70-12 20 12" stroke="#81ffff" strokeOpacity=".7"/></svg>
                <span className="core-coord coord-a">N 04.21</span><span className="core-coord coord-b">AI / 01</span><span className="core-coord coord-c">CORE ACTIVE</span>
              </div>
              <div className="core-caption"><span className="pulse-small" /> SYSTEM READY <span className="caption-divider">/</span> Awaiting your direction</div>
            </section>
            <aside className="side-stack">
              <section className="info-card project-info"><div className="info-card-head"><span className="info-icon cyan"><Icon name="folder" /></span><span className="eyebrow">ACTIVE PROJECT</span><button className="icon-button" onClick={() => setPage("Projects")} aria-label="Open projects"><Icon name="arrow" size={15} /></button></div><h3>{project}</h3><p>{project === "Select a project" ? "Choose a local repository to start" : "Local repository selected"}</p><button className="select-project" onClick={() => setPage("Projects")}>{project === "Select a project" ? "Select repository" : "Change repository"}<Icon name="arrow" size={14} /></button></section>
              <section className="info-card task-info"><div className="info-card-head"><span className="info-icon orange"><Icon name="spark" /></span><span className="eyebrow">CODEX ACTIVITY</span><span className="live-tag"><i /> LIVE</span></div><div className="empty-activity"><div className="activity-glyph">⌁</div><strong>{running ? "Codex is working" : codexConnected ? "Session connected" : "No active tasks"}</strong><span>{agentText ? agentText.slice(-90) : running ? "Streaming actual session updates…" : codexConnected ? "Ready for a reviewed prompt." : "Connect Codex to stream real task activity."}</span></div><button className="text-link" onClick={() => setPage("Tasks")}>View task center <Icon name="arrow" size={14} /></button></section>
            </aside>
          </div>

          <section className="command-panel"><div className="command-top"><div><div className="eyebrow"><span className="command-dot" /> COMMAND INPUT</div><h3>What are we building today?</h3></div><span className="keyboard-hint"><kbd>ENTER</kbd> REVIEW PROMPT <span className="shortcut-separator">·</span> <kbd>CTRL</kbd><kbd>SHIFT</kbd><kbd>SPACE</kbd> VOICE</span></div><form className="command-form" onSubmit={e => { e.preventDefault(); reviewPrompt(); }}><Icon name="spark" size={18} /><input value={command} onChange={e => setCommand(e.target.value)} placeholder={recording ? "Listening… release the button to transcribe" : transcribing ? "Transcribing your voice…" : "Describe what you want NEXUS to help you with..."} aria-label="Describe your development task" /><button className={`mic-button ${recording ? "recording" : ""}`} type="button" onPointerDown={e => { e.preventDefault(); void startRecording(); }} onPointerUp={stopRecording} onPointerCancel={stopRecording} onPointerLeave={() => { if (recordingRequested.current) stopRecording(); }} disabled={transcribing} aria-label="Hold to speak"><Icon name="mic" size={18} /><span>{recording ? "LISTENING" : transcribing ? "WAIT" : "HOLD TO SPEAK"}</span></button><button className="review-button" type="submit" disabled={!command.trim() || recording || transcribing}>Review prompt <Icon name="arrow" size={16} /></button></form><div className="command-foot"><span>Nothing is sent until you review and approve the prompt.</span><span>LOCAL SESSION <i /> KEY STORED SECURELY</span></div></section>

          <footer className="bottom-strip"><span><i className="footer-square" /> NEXUS VOICE <span className="footer-muted">BUILD 0.1.0 / PREVIEW</span></span><span>DESIGNED FOR FOCUS <b>·</b> POWERED BY YOUR TOOLS</span></footer>
        </section>}

        {page === "Projects" && <section className="content-page"><div className="eyebrow"><span className="eyebrow-line" /> WORKSPACE</div><h1>Projects<span className="cyan-dot">.</span></h1><p className="page-lede">Choose the local repository Codex should work in.</p><div className="empty-panel"><div className="empty-orb"><Icon name="folder" size={22} /></div><h2>{projectPath ? project : "No repository selected"}</h2><p>{projectPath ? projectPath : "Select a local folder to use as your workspace. NEXUS will use its path when connecting to Codex."}</p><button className="primary-action" onClick={pickProject}>{projectPath ? "Change repository" : "Select a local repository"} <Icon name="arrow" /></button></div></section>}
        {page === "Tasks" && <section className="content-page"><div className="eyebrow"><span className="eyebrow-line" /> EXECUTION</div><h1>Task center<span className="cyan-dot">.</span></h1><p className="page-lede">See actual Codex sessions, progress and approval requests.</p><div className="empty-panel"><div className="empty-orb orange-orb"><Icon name="tasks" size={22} /></div><h2>{running ? "Codex is working" : codexConnected ? "Codex session ready" : "No Codex session connected"}</h2><p>{codexError || (agentText || (codexConnected ? `Session ${threadId || "connected"}. ${running ? "Live updates appear here while Codex works." : "Review a prompt before sending a turn."}` : "Connect the installed Codex CLI using your existing sign-in. Tasks run in the selected local project."))}</p>{agentText && <pre className="agent-output">{agentText}</pre>}{running ? <button className="secondary-action" onClick={interruptCodex}>Interrupt current turn</button> : <button className="primary-action" onClick={connectCodex} disabled={connecting || !projectPath}>{connecting ? "Connecting…" : codexConnected ? "Reconnect / resume session" : "Connect Codex"}<Icon name="arrow" /></button>}</div></section>}
        {page === "History" && <section className="content-page"><div className="eyebrow"><span className="eyebrow-line" /> ACTIVITY LOG</div><h1>History<span className="cyan-dot">.</span></h1><p className="page-lede">A record of prompts you review and tasks Codex actually runs.</p><div className="empty-panel"><div className="empty-orb"><Icon name="history" size={22} /></div><h2>Nothing here yet</h2><p>Completed sessions and prompt activity will appear here after your first connected task.</p></div></section>}
        {page === "Settings" && <section className="content-page settings-page"><div className="eyebrow"><span className="eyebrow-line" /> CONFIGURATION</div><h1>Settings<span className="cyan-dot">.</span></h1><p className="page-lede">Choose how NEXUS connects to your tools. Credentials are stored on this device.</p><div className="settings-layout"><section className="settings-card"><div className="settings-card-title"><span className="info-icon cyan"><Icon name="key" /></span><div><h2>OpenAI API</h2><p>Voice transcription uses your API key. API billing is separate from ChatGPT subscriptions.</p></div></div><label className="field-label" htmlFor="api-key">API KEY {apiKeySaved && <span className="saved-key-tag">SAVED IN WINDOWS CREDENTIAL MANAGER</span>}</label><input id="api-key" className="settings-input" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={apiKeySaved ? "Enter a new key to replace it, or leave blank to remove" : "sk-…"} /><div className="field-help">The key is stored in Windows Credential Manager and never written to browser storage. Voice recordings are sent to OpenAI for transcription only after you release push-to-talk.</div><button className="primary-action" onClick={saveSettings}>{saved ? <><Icon name="check" /> Saved</> : <>Save provider settings <Icon name="arrow" /></>}</button><label className="spoken-setting"><input type="checkbox" checked={spokenUpdates} onChange={event => { setSpokenUpdates(event.target.checked); localStorage.setItem("nexus-spoken-updates", String(event.target.checked)); }} /><span><strong>Speak status updates</strong><small>Use the Windows voice for short completion and approval announcements.</small></span></label></section><section className="settings-card integration-card"><div className="settings-card-title"><span className="info-icon orange"><Icon name="spark" /></span><div><h2>Codex app-server</h2><p>{codexConnected ? "Connected to your local Codex CLI session." : "Use your local Codex CLI and existing sign-in."}</p></div></div><div className="integration-status"><span className="status-led" /> {codexConnected ? "CONNECTED" : "LOCAL CLI · READY"} <span className="status-note">{codexConnected ? "SESSION ACTIVE" : "NOT CONNECTED"}</span></div><p className="integration-copy">Tasks use Codex’s local stdio JSON-RPC app-server, its own sign-in, sandbox and approval flow. No credentials are copied into NEXUS.</p><button className="secondary-action" onClick={connectCodex} disabled={connecting || !projectPath}>{connecting ? "Connecting…" : codexConnected ? "Reconnect / resume" : "Connect Codex"} <Icon name="arrow" /></button>{!projectPath && <div className="field-help">Select a project folder before connecting.</div>}</section></div></section>}

        <div className="mobile-nav">{pages.slice(0, 3).map(item => <button key={item.name} onClick={() => setPage(item.name)} className={page === item.name ? "active" : ""}><Icon name={item.icon} size={17} /><span>{item.name}</span></button>)}<button onClick={() => setPage("Settings")} className={page === "Settings" ? "active" : ""}><Icon name="settings" size={17} /><span>Settings</span></button></div>
      </section>

      {reviewOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setReviewOpen(false); }}><section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modal-head"><div><div className="eyebrow"><span className="eyebrow-line" /> HUMAN REVIEW REQUIRED</div><h2 id="review-title">Review your prompt<span className="cyan-dot">.</span></h2></div><button className="icon-button" onClick={() => setReviewOpen(false)} aria-label="Close prompt review"><Icon name="close" /></button></div><div className="review-context"><span className="context-tag"><Icon name="folder" size={14} /> {project}</span><span className="context-tag muted-tag">{codexConnected ? "CODEX SESSION · READY" : "CODEX SESSION · NOT CONNECTED"}</span></div><label className="field-label">ORIGINAL REQUEST</label><div className="original-request">{reviewOriginal}</div><label className="field-label" htmlFor="prompt-draft">EDITABLE CODEX PROMPT</label><textarea id="prompt-draft" autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={8} /><div className="review-notice"><span className="notice-mark">i</span><span>{codexConnected ? "Review the prompt; sending starts a real Codex turn in your selected project." : "This is a draft. Connect Codex before sending; no task has been started."}</span></div><div className="modal-actions"><button className="secondary-action" onClick={() => { navigator.clipboard?.writeText(draft); setToast("Prompt copied to clipboard"); }}>Copy prompt</button><div><button className="secondary-action" onClick={() => setReviewOpen(false)}>Back to edit</button><button className="review-button" onClick={sendToCodex} disabled={!codexConnected || !draft.trim()} title={!codexConnected ? "Connect Codex before sending" : "Start a Codex turn"}>Send to Codex <Icon name="arrow" size={15} /></button></div></div></section></div>}
      {approval && <div className="modal-backdrop"><section className="review-modal approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="modal-head"><div><div className="eyebrow"><span className="eyebrow-line" /> CODEX REQUESTS YOUR APPROVAL</div><h2 id="approval-title">Review requested action<span className="cyan-dot">.</span></h2></div></div><p className="approval-description">{approval.method === "item/commandExecution/requestApproval" ? "Codex wants permission to run a command." : approval.method === "item/fileChange/requestApproval" ? "Codex requests approval for a file change." : `Codex requests approval: ${approval.method}`}</p><pre className="agent-output">{JSON.stringify(approval.params ?? {}, null, 2)}</pre><div className="review-notice"><span className="notice-mark">!</span><span>Review this request before allowing Codex to continue.</span></div><div className="modal-actions"><span /><div><button className="secondary-action" onClick={() => respondToApproval("decline")}>Decline</button><button className="review-button" onClick={() => respondToApproval("accept")}>Approve once <Icon name="check" size={15} /></button></div></div></section></div>}
      {toast && <div className="toast" role="status"><span className="toast-led" />{toast}</div>}
    </main>
  );
}

export default App;
