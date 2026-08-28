"use client";

import { cn } from "@/lib/cn";

export function Sparkline({
  series,
  width = 120,
  height = 28,
  color = "#3EE9A7",
  className,
  showDot = true,
}: {
  series: Array<{ t: number; v: number }>;
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  showDot?: boolean;
}) {
  if (series.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("overflow-visible", className)}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          className="text-ink-600"
        />
      </svg>
    );
  }

  const values = series.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 1;
  const yMin = min - pad;
  const yMax = max + pad;

  const xStep = width / Math.max(1, series.length - 1);
  const points = series.map((p, i) => {
    const x = i * xStep;
    const y = height - ((p.v - yMin) / (yMax - yMin)) * height;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
    >
      <path d={areaPath} fill={color} opacity={0.15} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showDot ? (
        <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
      ) : null}
    </svg>
  );
}
