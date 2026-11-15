// Reads simulation alerts aloud, one at a time.
// ElevenLabs (through the server's /api/speak route) is used when configured;
// otherwise, or if it fails, the browser's built-in speech voice takes over.

export type AlertSeverity = "critical" | "warning" | "watch" | "info";
export type SpokenAlert = { id: number; sev: AlertSeverity; title: string };

const MUTE_KEY = "aeroflo-voice-muted";
const MAX_QUEUE = 3;
const REPEAT_WINDOW_MS = 60_000;
const SEVERITY_WORD: Record<AlertSeverity, string> = { critical: "Critical alert", warning: "Warning", watch: "Watch", info: "Notice" };
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 3, warning: 2, watch: 1, info: 0 };

export function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function saveMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* storage unavailable: keep in memory only */ }
}

/** Turn a dashboard title into a sentence that sounds natural when spoken. */
export function alertSentence(alert: SpokenAlert): string {
  const title = alert.title
    .replace(/~\s*/g, "about ")
    .replace(/\bmin\b/g, "minute")
    .replace(/\/hr\b/g, " per hour")
    .replace(/[()]/g, ", ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();
  if (alert.id === 0) return `${title}.`; // app message (e.g. the unmute confirmation), not a simulation alert
  return `${SEVERITY_WORD[alert.sev] ?? "Alert"}. ${title}.`;
}

export function createAlertVoice(options: { useServerVoice: () => boolean; isMuted: () => boolean }) {
  const queue: SpokenAlert[] = [];
  const lastSpoken = new Map<string, number>();
  let busy = false;
  let currentAudio: HTMLAudioElement | null = null;
  let audioContext: AudioContext | null = null;

  function chime(sev: AlertSeverity) {
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return Promise.resolve();
      audioContext ??= new Context();
      const ctx = audioContext;
      const notes = sev === "critical" ? [880, 660, 880] : sev === "warning" ? [740, 554] : [620];
      notes.forEach((frequency, index) => {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        const start = ctx.currentTime + index * 0.16;
        oscillator.type = "sine"; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(start); oscillator.stop(start + 0.15);
      });
      return new Promise<void>(resolve => setTimeout(resolve, notes.length * 160 + 60));
    } catch { return Promise.resolve(); }
  }

  function browserSpeak(text: string) {
    return new Promise<void>(resolve => {
      if (!("speechSynthesis" in window)) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
      setTimeout(resolve, 15_000); // never let a stuck utterance block the queue
    });
  }

  async function serverSpeak(text: string) {
    const response = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("audio")) throw new Error("Server voice unavailable");
    const url = URL.createObjectURL(await response.blob());
    try {
      if (options.isMuted()) return;
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url);
        currentAudio = audio;
        audio.onended = () => resolve();
        audio.onpause = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
    } finally {
      currentAudio = null;
      URL.revokeObjectURL(url);
    }
  }

  async function drain() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && !options.isMuted()) {
        const alert = queue.shift()!;
        const text = alertSentence(alert);
        await chime(alert.sev);
        if (options.isMuted()) break;
        if (options.useServerVoice()) {
          try { await serverSpeak(text); continue; } catch { /* fall back to the browser voice below */ }
        }
        if (!options.isMuted()) await browserSpeak(text);
      }
    } finally { busy = false; }
  }

  return {
    announce(alert: SpokenAlert) {
      if (options.isMuted() || !alert.title) return;
      const now = Date.now();
      const key = `${alert.sev}|${alert.title}`;
      if (now - (lastSpoken.get(key) ?? 0) < REPEAT_WINDOW_MS) return;
      lastSpoken.set(key, now);
      queue.push(alert);
      // Keep the queue short: when it overflows, drop the least severe, oldest alert.
      while (queue.length > MAX_QUEUE) {
        let drop = 0;
        queue.forEach((item, index) => { if (SEVERITY_RANK[item.sev] < SEVERITY_RANK[queue[drop].sev]) drop = index; });
        queue.splice(drop, 1);
      }
      void drain();
    },
    stop() {
      queue.length = 0;
      currentAudio?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
  };
}
