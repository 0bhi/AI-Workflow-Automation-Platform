"use client";

import { useEffect, useState } from "react";
import {
  listTenantUsers,
  listPendingInvites,
  sendInvite,
  updateUserRole,
  getAuthMe,
  type TenantUser,
  type PendingInvite,
  type AuthMe,
} from "@lib/api/client";

export default function TeamPage() {
  const [me, setMe] = useState<AuthMe | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastInviteToken, setLastInviteToken] = useState<string | null>(null);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const identity = await getAuthMe();
        if (cancelled) return;
        setMe(identity);

        if (identity.role === "admin") {
          const [u, inv] = await Promise.all([
            listTenantUsers(),
            listPendingInvites(),
          ]);
          if (!cancelled) {
            setUsers(u);
            setInvites(inv);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load team data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;
    setSending(true);
    setSendError(null);
    setLastInviteToken(null);

    try {
      const inv = await sendInvite({ email: inviteEmail, role: inviteRole });
      setInvites((prev) => [inv, ...prev]);
      setLastInviteToken(inv.token);
      setInviteEmail("");
    } catch (err: any) {
      setSendError(err.message ?? "Failed to send invite");
    } finally {
      setSending(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    try {
      await updateUserRole(userId, newRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch {
      // silently ignore for now
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-slate-400">Loading team data…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-slate-400">
          Only admins can view and manage the team. Your current role is{" "}
          <span className="font-semibold text-slate-200">{me?.role ?? "unknown"}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-slate-400">
          Manage users and invitations for tenant{" "}
          <span className="font-mono">{me?.tenantName ?? me?.tenantId}</span>.
        </p>
      </header>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {/* Invite form */}
      <section className="card space-y-4">
        <h2 className="text-sm font-semibold">Send invite</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleSendInvite}>
          <div className="space-y-1 text-xs">
            <label className="block text-slate-300">Email</label>
            <input
              type="email"
              required
              className="w-64 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              placeholder="user@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1 text-xs">
            <label className="block text-slate-300">Role</label>
            <select
              className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="admin">admin</option>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <button
            type="submit"
            className="btn-primary text-xs disabled:opacity-60"
            disabled={sending}
          >
            {sending ? "Sending…" : "Send invite"}
          </button>
        </form>
        {sendError && <p className="text-xs text-red-400">{sendError}</p>}
        {lastInviteToken && (
          <div className="rounded-md border border-sky-800/50 bg-sky-950/40 px-3 py-2 text-xs text-sky-200">
            <p className="font-semibold">Invite sent successfully.</p>
            <p className="mt-1 break-all font-mono text-[11px] text-sky-300/80">
              Accept URL (local): {typeof window !== "undefined" ? window.location.origin : ""}/accept-invite?token={lastInviteToken}
            </p>
          </div>
        )}
      </section>

      {/* Existing users */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold">Members ({users.length})</h2>
        {users.length === 0 ? (
          <p className="text-xs text-slate-500">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-900/70 text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Joined</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-slate-800/60">
                    <td className="px-3 py-2 text-slate-200">{user.email}</td>
                    <td className="px-3 py-2">
                      {user.id === me?.sub ? (
                        <span className="rounded-full bg-sky-900/50 px-2 py-0.5 text-[10px] text-sky-300">
                          {user.role} (you)
                        </span>
                      ) : (
                        <select
                          className="rounded border border-slate-700 bg-slate-900/60 px-1.5 py-0.5 text-[11px] text-slate-200"
                          value={user.role}
                          onChange={(e) =>
                            void handleRoleChange(user.id, e.target.value)
                          }
                        >
                          <option value="admin">admin</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      <span className="font-mono text-[10px]">{user.id}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending invites */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold">Pending invites ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="text-xs text-slate-500">No pending invites.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-900/70 text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Expires</th>
                  <th className="px-3 py-2 text-left">Token</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-800/60">
                    <td className="px-3 py-2 text-slate-200">{inv.email}</td>
                    <td className="px-3 py-2 text-slate-300">{inv.role}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500 max-w-[200px] truncate">
                      {inv.token}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
