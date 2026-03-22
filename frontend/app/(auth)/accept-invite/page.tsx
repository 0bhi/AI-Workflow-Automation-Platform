"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { acceptInvite } from "@lib/api/client";

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenParam);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await acceptInvite({ token, password });

      if (typeof window !== "undefined") {
        window.localStorage.setItem("authToken", data.token);
        window.localStorage.setItem("tenantId", data.tenantId);
      }

      window.location.href = "/workflows";
    } catch (err: any) {
      setError(err.message ?? "Failed to accept invite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Accept invitation</h1>
          <p className="text-sm text-slate-400">
            Enter the invite token and choose a password to join the tenant.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1 text-left">
            <label className="text-sm font-medium text-slate-200">
              Invite token
            </label>
            <input
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="Paste your invite token"
            />
          </div>
          <div className="space-y-1 text-left">
            <label className="text-sm font-medium text-slate-200">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="Choose a password"
            />
          </div>
          {error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : null}
          <button
            type="submit"
            className="btn-primary w-full disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Joining…" : "Join tenant"}
          </button>
        </form>
        <p className="text-center text-xs text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
