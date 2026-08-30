import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import type { ImageAttachment } from "../api/client";
import { resizeToJpeg } from "../lib/resizeImage";

interface PhotoAttachProps {
  image: ImageAttachment | null;
  onAttach: (image: ImageAttachment) => void;
  onClear: () => void;
}

export function PhotoAttach({ image, onAttach, onClear }: PhotoAttachProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the exact same file again still fire onChange
    if (!file) return;
    setError(null);
    try {
      onAttach(await resizeToJpeg(file));
    } catch {
      setError("Couldn't read that photo — try again.");
    }
  }

  if (image) {
    return (
      <div className="relative size-14">
        <img
          src={`data:${image.mime};base64,${image.base64}`}
          alt="Attached food photo"
          className="size-full rounded-full object-cover shadow-sm ring-1 ring-ink/5"
        />
        <button
          className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-coral text-white shadow-sm transition-transform active:scale-95"
          onClick={onClear}
          aria-label="Remove photo"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        className="grid size-14 place-items-center rounded-full bg-white text-ink/70 shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
        onClick={() => inputRef.current?.click()}
        aria-label="Add a photo"
        title="Add a photo"
      >
        <Camera className="size-5" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
      {error && <p className="mt-1.5 text-[11px] font-semibold text-coral">{error}</p>}
    </div>
  );
}
