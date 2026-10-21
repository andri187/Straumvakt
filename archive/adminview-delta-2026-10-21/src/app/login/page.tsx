import { LoginAuthSwitcher } from "@/components/login-auth-switcher";

export const metadata = { title: "Sign in" };

/**
 * Straumvakt brand mark for the login card.
 */
function StraumvaktMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="svLoginBolt"
          x1="40"
          y1="20"
          x2="80"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8EF5C7" />
          <stop offset="100%" stopColor="#6FDCEA" />
        </linearGradient>
      </defs>
      <path
        d="M 84 18 L 54 18 A 24 24 0 0 0 30 42 L 30 60"
        stroke="#3EE9A7"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 36 102 L 66 102 A 24 24 0 0 0 90 78 L 90 60"
        stroke="#2BB6E8"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z"
        fill="url(#svLoginBolt)"
      />
    </svg>
  );
}

export default function LoginPage() {
  const version = process.env.APP_VERSION ?? "dev";
  const buildTime = process.env.BUILD_TIME ?? "unknown";

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      {/* Soft brand halo behind the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-brand-halo"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-bg-border bg-bg-surface/90 p-8 shadow-card backdrop-blur">
        {/* Brand lockup */}
        <div className="flex items-center gap-3">
          <StraumvaktMark className="h-11 w-11" />
          <div>
            <div className="sv-wordmark text-xl font-bold leading-tight">
              Straumvakt
            </div>
            <div className="sv-tagline">Control · Overview · Convenience</div>
          </div>
        </div>

        <h1 className="mt-8 text-xl font-semibold text-ink-50">Sign in</h1>
        <LoginAuthSwitcher />
      </div>

      <div className="absolute inset-x-0 bottom-4 text-center text-xs text-ink-400 tabular-nums tracking-wide">
        <span>v{version}</span>
        <span className="mx-2 text-ink-500">·</span>
        <span>build {buildTime}</span>
      </div>
    </div>
  );
}
