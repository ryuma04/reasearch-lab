"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Microphone, PaperPlaneTilt, Stop } from "@phosphor-icons/react";
import { runApi, voiceApi, type VoiceIntent } from "@/lib/api/services";
import { qk } from "@/lib/hooks/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

/**
 * Mobile control (Must-build #12, Hero 9): type or speak a command. The backend turns it into
 * an intent (Groq Whisper for voice); anything that changes the work needs a one-tap Yes,
 * which then calls the normal API for that action. Nothing happens without the confirmation.
 */
export function CommandPanel({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [heard, setHeard] = React.useState<string | null>(null);
  const [intent, setIntent] = React.useState<VoiceIntent | null>(null);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recording, setRecording] = React.useState(false);
  const recorder = React.useRef<MediaRecorder | null>(null);

  const understood = (res: { text: string; intent: VoiceIntent }) => {
    setHeard(res.text);
    setIntent(res.intent);
    setResult(res.intent.needs_confirm ? null : (res.intent.reply as string) || null);
  };

  const run = async (fn: () => Promise<{ text: string; intent: VoiceIntent }>) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      understood(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not understand the command");
    } finally {
      setBusy(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void run(() => voiceApi.command(new Blob(chunks, { type: rec.mimeType || "audio/webm" })));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("Microphone is not available; type the command instead.");
    }
  };

  const confirm = async () => {
    if (!intent) return;
    const target = String(intent.run_id || runId);
    setBusy(true);
    setError(null);
    try {
      switch (intent.action) {
        case "approve":
        case "reject":
        case "edit":
          await runApi.checkpoint(target, intent.checkpoint || "plan", {
            decision: intent.action,
            instructions: (intent.instruction as string) || undefined,
          });
          break;
        case "whatif":
          await runApi.createWhatIf(target, { question: (intent.question as string) || heard || "" });
          break;
        case "pause":
        case "resume":
        case "stop":
        case "retry":
          await runApi.agentAction(target, "run", { action: intent.action });
          break;
        case "instruct":
          await runApi.agentAction(target, "run", { action: "instruct", instruction: (intent.instruction as string) || heard || "" });
          break;
        case "push":
          setResult("Open the Publish page to review the secret scan and start the Hugging Face publish.");
          setIntent(null);
          return;
        default:
          setResult("Nothing to do for that command.");
          setIntent(null);
          return;
      }
      setResult(`Done: ${intent.action} sent for run #${target}.`);
      setIntent(null);
      void qc.invalidateQueries({ queryKey: qk.run(target) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="bento" className="p-4">
      <p className="font-display font-bold">Command the lab</p>
      <p className="text-xs text-muted">Type or speak, e.g. “How is the run going?” or “Try temperature 5 as a new branch”.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void run(() => voiceApi.text(text.trim()));
        }}
      >
        <input aria-label="Command" value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm" placeholder="Type a command" />
        <Button type="submit" size="sm" disabled={busy || !text.trim()} aria-label="Send command"><PaperPlaneTilt size={16} /></Button>
        <Button type="button" size="sm" variant={recording ? "danger" : "secondary"} onClick={toggleRecording} disabled={busy}
          aria-label={recording ? "Stop recording" : "Speak a command"}>
          {recording ? <Stop size={16} /> : <Microphone size={16} />}
        </Button>
      </form>
      {heard && <p className="mt-3 text-xs text-muted">Heard: “{heard}”</p>}
      {intent?.needs_confirm === true && (
        <div className="mt-2 rounded-2xl bg-warning-soft p-3 text-sm">
          <p>
            <b>{intent.action}</b>
            {intent.question ? `: ${String(intent.question)}` : intent.instruction ? `: ${String(intent.instruction)}` : ""} on run #{intent.run_id || runId}?
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="lg" variant="success" onClick={confirm} loading={busy}>Yes</Button>
            <Button size="lg" variant="secondary" onClick={() => setIntent(null)} disabled={busy}>No</Button>
          </div>
        </div>
      )}
      {result && <p role="status" className="mt-2 text-sm">{result}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
