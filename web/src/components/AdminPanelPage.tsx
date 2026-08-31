import { useEffect, useState } from "react";
import { Inbox, Sparkles } from "lucide-react";
import { ApiError, fetchAdminUsers, type AdminUserRow } from "../api/client";
import { BackHeader } from "./BackHeader";

interface AdminPanelPageProps {
  onBack: () => void;
  onOpenFeedbackInbox: () => void;
  onOpenModelsInUse: () => void;
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Landing page for the admin-only area (2026-08-31). Deliberately small —
// a users table plus links out to the pages that used to sit directly in
// the hamburger menu — with more admin views expected to move in here over
// time rather than staying scattered across top-level menu items.
export function AdminPanelPage({ onBack, onOpenFeedbackInbox, onOpenModelsInUse }: AdminPanelPageProps) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load users."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title="Admin panel" subtitle="Deep Blue, from the inside" onBack={onBack} />

      <div className="flex gap-3">
        <button
          className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-ink shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
          onClick={onOpenFeedbackInbox}
        >
          <Inbox className="size-4 text-coral" />
          Feedback inbox
        </button>
        <button
          className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-ink shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
          onClick={onOpenModelsInUse}
        >
          <Sparkles className="size-4 text-sky" />
          Models in use
        </button>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/40">
          Users {!loading && `(${users.length})`}
        </h2>

        {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
        {error && (
          <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
            {error}
          </p>
        )}
        {!loading && !error && users.length === 0 && (
          <p className="py-10 text-center text-sm font-medium text-ink/40">No registered users yet.</p>
        )}

        {!loading && !error && users.length > 0 && (
          <div className="overflow-hidden rounded-[2rem] bg-white shadow-sm ring-1 ring-ink/5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/5">
                  <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-ink/40">
                    Username
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-ink/40">
                    Usage
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id} className="border-b border-ink/5 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-bold text-ink">{user.username}</div>
                      <div className="text-xs font-medium text-ink/40">Joined {fmtDate(user.created_at)}</div>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-ink">{fmtUsd(user.total_usage_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
