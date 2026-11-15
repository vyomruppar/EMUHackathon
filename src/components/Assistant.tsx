import { useState } from "react";
import { ArrowUp, Check, Sparkles } from "lucide-react";
import { GROQ_API_KEYS_URL, isLocalDevelopment, VERCEL_ENVIRONMENT_SETTINGS_URL } from "../data/setup";
import type { AiReply, ScenarioProposal } from "../types";

interface Message { role: "user" | "assistant"; text: string; reply?: AiReply }
interface Props {
  configured: boolean;
  providerState: string;
  context: object;
  onRunProposal: (proposal: ScenarioProposal) => void;
  onProviderChange: (state: string) => void;
}
export function Assistant({ configured, providerState, context, onRunProposal, onProviderChange }: Props) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

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
  return <div className="assistant-panel">
    <div className="panel-heading"><span className="panel-heading-icon"><Sparkles size={18} /></span><div><span className="eyeline">RESEARCH COMPANION</span><h2>AI Assistant</h2></div></div>
    <p className="panel-intro">Ask about the visible map or describe a hypothetical event. Every proposed scenario waits for your review.</p>
    {!configured ? <div className="setup-card" role="status"><strong>Groq setup needed</strong><p>{isLocalDevelopment() ? <>Create a Groq API key, set <code>GROQ_API_KEY</code> in <code>.env.local</code>, then restart the app.</> : <>Add <code>GROQ_API_KEY</code> to the Vercel project environment settings, then redeploy.</>} The key stays server-side. The map and simulations still work.</p><a className="text-button setup-link" href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Get a Groq API key</a>{!isLocalDevelopment() && <a className="text-button setup-link" href={VERCEL_ENVIRONMENT_SETTINGS_URL} target="_blank" rel="noreferrer">Open Vercel environment settings</a>}</div> : <>
      <div className="assistant-status"><span className={`status-dot ${providerState === "working" ? "good" : "amber"}`} />{providerState === "working" ? "Provider checked and working" : providerState === "error" ? "Last request failed" : "Configured · awaiting first check"}</div>
      <div className="suggestions"><button onClick={() => submit("What does the current map show, and how recent is the data?")}>Explain this map</button><button onClick={() => submit("What might happen if JFK has a 30 minute runway closure? Propose a synthetic scenario.")}>Propose a JFK closure</button></div>
      <div className="chat-history" aria-live="polite">
        {messages.length === 0 ? <div className="chat-empty"><Sparkles size={24}/><strong>Start with the airspace you see.</strong><span>Answers cite the current source, timestamp, and assumptions.</span></div> : messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}>
          <div className="chat-message-label">{message.role === "user" ? "YOU" : "AI · EDUCATIONAL"}</div>
          <p>{message.text}</p>
          {message.reply ? <>
            <div className="answer-meta">Source: {message.reply.source}<br/>Snapshot: {message.reply.sourceTimestamp ? new Date(message.reply.sourceTimestamp).toLocaleString() : "Unavailable"}</div>
            {message.reply.evidence.length > 0 && <div className="answer-list"><strong>Used</strong>{message.reply.evidence.map((item, i) => <span key={i}>• {item}</span>)}</div>}
            {message.reply.assumptions.length > 0 && <div className="answer-list"><strong>Assumptions</strong>{message.reply.assumptions.map((item, i) => <span key={i}>• {item}</span>)}</div>}
            {message.reply.proposal && <div className="proposal-review"><span className="sim-tag">SIMULATION PROPOSAL</span><h3>Review before running</h3><dl><dt>Location</dt><dd>{message.reply.proposal.locationName}</dd><dt>Event</dt><dd>{message.reply.proposal.eventType.replaceAll("_", " ")}</dd><dt>Duration</dt><dd>{message.reply.proposal.durationMinutes} min</dd><dt>Traffic</dt><dd>{message.reply.proposal.syntheticAircraftCount} synthetic aircraft</dd></dl><p>{message.reply.proposal.description}</p><button className="button-primary full" onClick={() => { onRunProposal(message.reply!.proposal!); setConfirmed(String(index)); }}><Check size={16}/> {confirmed === String(index) ? "Loaded in Simulation" : "Confirm & load simulation"}</button></div>}
            <div className="uncertain-note">AI-generated; forecasts are uncertain model estimates, never operational guidance.</div>
          </> : null}
        </div>)}
        {busy && <div className="chat-message assistant"><div className="chat-message-label">AI · THINKING</div><p>Reviewing the visible context…</p></div>}
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <form className="chat-form" onSubmit={event => { event.preventDefault(); void submit(); }}><label className="sr-only" htmlFor="assistant-input">Ask the AIRSPACE assistant</label><textarea id="assistant-input" value={input} onChange={event => setInput(event.target.value)} placeholder="Ask about this map or a hypothetical event…" rows={2} maxLength={1000}/><button aria-label="Send question" disabled={!input.trim() || busy} type="submit"><ArrowUp size={18}/></button></form>
    </>}
  </div>;
}
