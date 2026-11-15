import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Plane, X } from "lucide-react";
import { GROQ_API_KEYS_URL, isLocalDevelopment, VERCEL_ENVIRONMENT_SETTINGS_URL } from "../data/setup";
import type { AiReply, ScenarioProposal } from "../types";

interface Message { role: "user" | "assistant"; text: string; reply?: AiReply }
interface ProposalHandoffState { key: string; status: "pending" | "loaded" | "error"; message: string }
interface Props {
  configured: boolean;
  providerState: string;
  context: object;
  proposalHandoff?: ProposalHandoffState | null;
  onRunProposal: (proposal: ScenarioProposal) => void;
  onProviderChange: (state: string) => void;
  onClose: () => void;
}

const starterPrompts = [
  "Explain the traffic currently on this map",
  "What might happen during a 30 minute JFK runway closure?",
];

export function Assistant({ configured, providerState, context, proposalHandoff, onRunProposal, onProviderChange, onClose }: Props) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, error, proposalHandoff]);

  async function submit(text = input) {
    const message = text.trim();
    if (!message || busy || !configured) return;
    setInput(""); setError(null); setBusy(true);
    setMessages(previous => [...previous, { role: "user", text: message }]);
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, context }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The AI request failed.");
      setMessages(previous => [...previous, { role: "assistant", text: data.answer, reply: data as AiReply }]);
      onProviderChange("working");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The AI request failed."); onProviderChange("error"); }
    finally { setBusy(false); }
  }

  const providerLabel = !configured
    ? "Setup"
    : providerState === "working"
      ? "Ready"
      : providerState === "error"
        ? "Error"
        : "Not tested";

  return <section className="assistant-panel" aria-label="AeroFlo AI assistant">
    <header className="assistant-header">
      <div className="assistant-brand-mark" aria-hidden="true"><Plane size={15} fill="currentColor"/></div>
      <div className="assistant-title-block">
        <h2>AeroFlo Assistant</h2>
        <span>Map research companion</span>
      </div>
      <div className={`assistant-connection ${providerState === "working" ? "is-connected" : ""}`} role="status">
        <i className={`status-dot ${providerState === "working" ? "good" : "amber"}`}/>{providerLabel}
      </div>
      <button className="assistant-close" type="button" onClick={onClose} aria-label="Close AI assistant"><X size={17}/></button>
    </header>

    <div className="assistant-transcript" aria-live="polite" aria-label="Conversation">
      <div className="assistant-intro-row">
        <div className="assistant-avatar" aria-hidden="true">A</div>
        <div className="assistant-bubble assistant-intro-bubble">
          <div className="chat-message-label">AEROFLO ASSISTANT</div>
          <p>What would you like to explore?</p>
          <span>Ask about the map or prepare a hypothetical scenario. You review every proposal before it loads into Simulation.</span>
        </div>
      </div>

      {!configured ? <div className="assistant-setup-card" role="status">
        <div className="setup-card-heading"><i className="status-dot amber"/><strong>Assistant setup needed</strong></div>
        <p>{isLocalDevelopment() ? <>Add <code>GROQ_API_KEY</code> to the local <code>.env.local</code> file and restart the server.</> : <>Add <code>GROQ_API_KEY</code> in the Vercel project environment settings, then redeploy.</>} The assistant uses this key on the server.</p>
        <div className="assistant-setup-actions">
          <a className="assistant-link-button" href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Get a Groq API key <span aria-hidden="true">↗</span></a>
          {!isLocalDevelopment() && <a className="assistant-secondary-link" href={VERCEL_ENVIRONMENT_SETTINGS_URL} target="_blank" rel="noreferrer">Open environment settings</a>}
        </div>
      </div> : <>
        {messages.length === 0 && <div className="assistant-starters">
          <span className="assistant-section-label">TRY ASKING</span>
          {starterPrompts.map(prompt => <button key={prompt} type="button" onClick={() => void submit(prompt)} disabled={busy}>{prompt}<ArrowUp size={14}/></button>)}
        </div>}
        {messages.map((message, index) => <div className={`assistant-turn assistant-turn-${message.role}`} key={`${index}-${message.role}`}>
          {message.role === "assistant" && <div className="assistant-avatar" aria-hidden="true">A</div>}
          <div className="assistant-turn-content">
            {message.role === "assistant" && <div className="assistant-response-label">AEROFLO ASSISTANT</div>}
            <div className={`assistant-bubble ${message.role === "user" ? "user-bubble" : ""}`}>
              <p>{message.text}</p>
              {message.reply && <>
                <div className="answer-meta"><span>Source</span>{message.reply.source}<span>Snapshot</span>{message.reply.sourceTimestamp ? new Date(message.reply.sourceTimestamp).toLocaleString() : "Unavailable"}</div>
                {message.reply.evidence.length > 0 && <div className="answer-list"><strong>Data used</strong>{message.reply.evidence.map((item, i) => <span key={i}>{item}</span>)}</div>}
                {message.reply.assumptions.length > 0 && <div className="answer-list"><strong>Assumptions</strong>{message.reply.assumptions.map((item, i) => <span key={i}>{item}</span>)}</div>}
                {message.reply.proposal && (() => {
                  const proposal = message.reply!.proposal!;
                  const key = JSON.stringify([proposal.locationId, proposal.eventType, proposal.durationMinutes, proposal.syntheticAircraftCount, proposal.description]);
                  const state = proposalHandoff?.key === key ? proposalHandoff.status : null;
                  return <div className="proposal-review">
                  <div className="proposal-review-heading"><span className="sim-tag">SIMULATION PROPOSAL</span><span>{state === "loaded" ? "Added · review before running" : "Review required"}</span></div>
                  <h3>Proposed scenario</h3>
                  <dl><dt>Location</dt><dd>{proposal.locationName}</dd><dt>Event</dt><dd>{proposal.eventType.replaceAll("_", " ")}</dd><dt>Duration</dt><dd>{proposal.durationMinutes} min</dd><dt>Traffic focus</dt><dd>{proposal.syntheticAircraftCount} synthetic aircraft</dd></dl>
                  <p>{proposal.description}</p>
                  <button className="button-primary full" disabled={state === "pending" || state === "loaded"} onClick={() => onRunProposal(proposal)}>
                    {state === "loaded" ? <Check size={15}/> : <ArrowUp size={15}/>}
                    {state === "loaded" ? "Added to Simulation" : state === "pending" ? "Adding to Simulation…" : state === "error" ? "Retry in Simulation" : "Review in Simulation"}
                  </button>
                </div>;
                })()}
                <div className="uncertain-note">AI summary · uncertain model estimate · not operational guidance.</div>
              </>}
            </div>
            {message.reply && <div className="assistant-response-foot">Based on the visible map and model context</div>}
          </div>
        </div>)}
        {busy && <div className="assistant-turn assistant-turn-assistant"><div className="assistant-avatar" aria-hidden="true">A</div><div className="assistant-bubble assistant-thinking"><span/><span/><span/><em>Reviewing the map…</em></div></div>}
        {error && <div className="assistant-error" role="alert">{error}</div>}
        {proposalHandoff?.message && <div className="assistant-confirmation" role={proposalHandoff.status === "error" ? "alert" : "status"}>{proposalHandoff.message}</div>}
      </>}
      <div ref={transcriptEndRef}/>
    </div>

    {configured
      ? <footer className="assistant-composer-wrap">
        <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <label className="sr-only" htmlFor="assistant-input">Ask the AeroFlo assistant</label>
          <textarea id="assistant-input" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Ask a question or describe a scenario…" rows={2} maxLength={1000}/>
          <button aria-label="Send question" disabled={!input.trim() || busy} type="submit"><ArrowUp size={17}/></button>
        </form>
        <div className="composer-hint">Enter to send <span>·</span> Shift + Enter for a new line</div>
      </footer>
      : <footer className="assistant-unconfigured-footer">Map and simulations remain available while AI setup is incomplete.</footer>}
  </section>;
}
