import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import type { ImageAttachment } from "../api/client";

interface PhotoAttachProps {
  image: ImageAttachment | null;
  onAttach: (image: ImageAttachment) => void;
  onClear: () => void;
}

// Longest edge after resize — plenty for the model to read a plate of food,
// small enough to keep the request light and the vision cost down.
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.82;

function resizeToJpeg(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      resolve({ base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read image"));
    };
    img.src = url;
  });
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
      <div className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-4 shadow-sm ring-1 ring-ink/5">
        <div className="relative size-9 shrink-0 overflow-hidden rounded-full">
          <img
            src={`data:${image.mime};base64,${image.base64}`}
            alt="Attached food photo"
            className="size-full object-cover"
          />
        </div>
        <span className="text-xs font-bold text-ink/70">Photo attached — say what it is</span>
        <button
          className="grid size-6 shrink-0 place-items-center rounded-full text-ink/40 transition-colors hover:bg-coral/10 hover:text-coral"
          onClick={onClear}
          aria-label="Remove photo"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-ink/70 shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="size-4" />
        Add a photo
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
      {error && <p className="text-[11px] font-semibold text-coral">{error}</p>}
    </div>
  );
}
