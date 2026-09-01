import type { ReactNode } from "react";
import Link from "next/link";
import { AccountBadge } from "./AccountBadge";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800/60 bg-slate-950/95 px-3 py-5 backdrop-blur-sm">
        <div className="mb-8">
          <Link href="/workflows" className="text-base font-semibold tracking-tight text-slate-100">
            AI Workflows
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 text-sm">
          <Link
            href="/workflows"
            className="block rounded-lg px-3 py-2.5 text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            Workflows
          </Link>
          <Link
            href="/runs"
            className="block rounded-lg px-3 py-2.5 text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            Runs
          </Link>
          <Link
            href="/usage"
            className="block rounded-lg px-3 py-2.5 text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            Usage
          </Link>
          <Link
            href="/schedules"
            className="block rounded-lg px-3 py-2.5 text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            Schedules
          </Link>
          <Link
            href="/team"
            className="block rounded-lg px-3 py-2.5 text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            Team
          </Link>
          <Link
            href="/integrations"
            className="block rounded-lg px-3 py-2.5 text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
          >
            Integrations
          </Link>
        </nav>
        <AccountBadge />
      </aside>
      <main className="flex flex-1 flex-col min-h-0 bg-slate-950/60 px-6 py-4 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
