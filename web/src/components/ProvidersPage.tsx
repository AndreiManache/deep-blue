import { useEffect, useState } from "react";
import { ApiError, fetchProviders, type ProvidersSnapshot } from "../api/client";
import { BackHeader } from "./BackHeader";

interface ProvidersPageProps {
  onBack: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-sm font-semibold text-ink/50">{label}</span>
      <span className="text-right text-sm font-bold text-ink">{value}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[1.5rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-display text-sm font-extrabold uppercase tracking-wide text-ink/40">{title}</h2>
      <div className="mt-1 divide-y divide-ink/5">{children}</div>
    </div>
  );
}

export function ProvidersPage({ onBack }: ProvidersPageProps) {
  const [data, setData] = useState<ProvidersSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load provider info."));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-10 pt-5">
      <BackHeader title="Models in use" subtitle="What's actually live right now" onBack={onBack} />

      {error && <p className="text-sm font-semibold text-coral">{error}</p>}

      {data && (
        <div className="flex flex-col gap-4">
          <Card title="Conversation (LLM)">
            <Row label="Provider" value={data.llm.provider} />
            <Row label="Model" value={data.llm.model} />
            {data.llm.vision_model && <Row label="Photo model" value={data.llm.vision_model} />}
            {data.llm.thinking_level && <Row label="Thinking level" value={data.llm.thinking_level} />}
          </Card>

          <Card title="Reply voice (TTS)">
            <Row label="Default" value={`${data.tts.default.provider} · ${data.tts.default.model}`} />
            <Row label="Romanian profile" value={`${data.tts.romanian.provider} · ${data.tts.romanian.model}`} />
          </Card>

          <Card title="Your speech (STT)">
            <Row label="Default" value={`${data.stt.default.provider} · ${data.stt.default.model}`} />
            <Row label="Romanian profile" value={`${data.stt.romanian.provider} · ${data.stt.romanian.model}`} />
          </Card>

          <p className="px-1 text-xs font-medium text-ink/40">
            Both defaults apply to everyone except a profile with language explicitly set to Romanian —
            that's the only thing that switches a user to either Romanian row above.
          </p>
        </div>
      )}
    </div>
  );
}
