import type { ImageAttachment } from "../api/client";

// Shared by PhotoAttach.tsx (food-logging) and FeedbackPage.tsx
// (2026-08-30, image upload for feedback) — same resize target for both:
// plenty of detail to read either a plate of food or a screenshot of a bug,
// small enough to keep the request light either way.
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.82;

export function resizeToJpeg(file: File): Promise<ImageAttachment> {
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
