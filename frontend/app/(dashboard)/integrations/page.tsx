"use client";

import { useEffect, useState } from "react";
import {
  disconnectIntegration,
  getAuthMe,
  getSlackInstallUrl,
  listIntegrations,
  type AuthMe,
  type IntegrationConnection,
} from "@lib/api/client";

export default function IntegrationsPage() {
  const [me, setMe] = useState<AuthMe | null>(null);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const isAdmin = me?.role === "admin";

  async function refresh() {
    const items = await listIntegrations();
    setConnections(items);
  }

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_success") === "slack") {
      setBanner("Slack connected.");
    } else if (params.get("oauth_error")) {
      setBanner(`Slack OAuth failed: ${params.get("oauth_error")}`);
    }

    async function load() {
      try {
        const identity = await getAuthMe();
        if (cancelled) return;
        setMe(identity);
        await refresh();
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load integrations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const url = await getSlackInstallUrl();
      window.location.href = url;
    } catch (err: any) {
      setError(err.message ?? "Failed to start Slack install");
      setBusy(false);
    }
  }

  async function handleDisconnect(provider: string) {
    setBusy(true);
    setError(null);
    try {
      await disconnectIntegration(provider);
      await refresh();
      setBanner("Slack disconnected.");
    } catch (err: any) {
      setError(err.message ?? "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  }

  const slack = connections.find((c) => c.provider === "slack");

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-slate-400">
          Connect Slack so workflow Slack nodes can post messages. You can also set{" "}
          <code className="rounded bg-slate-800 px-1">SLACK_BOT_TOKEN</code> on the
          agent/backend as a fallback.
        </p>
      </header>

      {banner ? (
        <p className="text-sm text-emerald-400">{banner}</p>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <section className="card space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Slack</h2>
            {slack ? (
              <p className="mt-1 text-sm text-slate-400">
                Connected
                {slack.teamName ? ` · ${slack.teamName}` : ""}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Not connected.</p>
            )}
          </div>
          {isAdmin ? (
            slack ? (
              <button
                type="button"
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                disabled={busy}
                onClick={() => handleDisconnect("slack")}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-xs disabled:opacity-50"
                disabled={busy}
                onClick={handleConnect}
              >
                {busy ? "Redirecting…" : "Connect Slack"}
              </button>
            )
          ) : (
            <p className="text-xs text-slate-500">Admin only</p>
          )}
        </div>
      </section>
    </div>
  );
}
