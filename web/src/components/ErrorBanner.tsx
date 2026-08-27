interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="fixed bottom-6 left-1/2 z-50 w-[calc(100%-3rem)] max-w-sm -translate-x-1/2 rounded-2xl bg-ink px-5 py-4 text-sm font-semibold text-cream shadow-xl"
    >
      {message}
    </div>
  );
}
