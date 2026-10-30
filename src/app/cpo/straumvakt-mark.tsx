export function StraumvaktMark({
  className,
  gradientId = "svMarkBolt",
}: {
  className?: string;
  gradientId?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="40" y1="20" x2="80" y2="100" gradientUnits="userSpaceOnUse">
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
      <path d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z" fill={`url(#${gradientId})`} />
    </svg>
  );
}
