"use client";

import { useEffect, useState } from "react";
import { getAuthMe, type AuthMe } from "@lib/api/client";

export function AccountBadge() {
  const [me, setMe] = useState<AuthMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAuthMe()
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function handleLogout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("authToken");
      window.localStorage.removeItem("tenantId");
      window.location.href = "/login";
    }
  }

  if (!me) return null;

  return (
    <div className="mt-auto border-t border-slate-800/60 pt-3">
      <div className="flex items-center justify-between px-1">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-200">
            {me.tenantName ?? me.tenantSlug ?? "Tenant"}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {me.email} · {me.role}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
          aria-label="Log out"
          title="Log out"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
