type Surface = "popup" | "workspace" | "options";

export function App({ surface }: { surface: Surface }) {
  return (
    <main className={`app-shell app-shell--${surface}`}>
      <header className="brand-row">
        <span className="brand-mark" aria-hidden="true">C</span>
        <div>
          <p className="brand-name">CheatPet</p>
          <p className="brand-subtitle">Practice, with clarity.</p>
        </div>
        <span className="status-pill"><span /> Local workspace</span>
      </header>
      <section className="welcome-card">
        <p className="eyebrow">STUDY DESK</p>
        <h1>Build understanding, one question at a time.</h1>
        <p className="muted">A private practice space for questions you choose to explore.</p>
        <div className="setup-callout">
          <span className="setup-icon" aria-hidden="true">✦</span>
          <div>
            <strong>Your workspace is ready</strong>
            <p>Connect your own OpenAI key in settings to generate explanations.</p>
          </div>
        </div>
        <p className="surface-label">Current surface: {surface}</p>
      </section>
    </main>
  );
}
