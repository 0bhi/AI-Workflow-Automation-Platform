import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="max-w-3xl text-center space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          AI Workflow Automation Platform
        </h1>
        <p className="text-slate-300">
          Design, run, and monitor deterministic AI-powered workflows with
          agents, tools, and robust observability.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/login" className="btn-primary">
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}


