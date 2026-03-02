"use client";

import { useState } from "react";
import Link from "next/link";
import { API_BASE_URL } from "@lib/api/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        throw new Error(`Login failed with status ${res.status}`);
      }

      const data = (await res.json()) as {
        token: string;
        tenantId: string;
      };

      if (typeof window !== "undefined") {
        window.localStorage.setItem("authToken", data.token);
        window.localStorage.setItem("tenantId", data.tenantId);
      }

      window.location.href = "/workflows";
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Log in</h1>
          <p className="text-sm text-slate-400">
            Access your tenant dashboard and workflows.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1 text-left">
            <label className="text-sm font-medium text-slate-200">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-slate-900/60 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="you@company.com"
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
              className="w-full rounded-lg border border-border bg-slate-900/60 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="••••••••"
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
            {loading ? "Signing in..." : "Continue"}
          </button>
        </form>
        <p className="text-center text-xs text-slate-500">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}

