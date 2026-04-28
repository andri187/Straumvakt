"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const SWIPE_THRESHOLD_PX = 40;

export function AppScreenshotCarousel({
  images,
  label,
}: {
  images: string[];
  label: string;
}) {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  const clamp = (n: number) => Math.max(0, Math.min(images.length - 1, n));

  function go(delta: number) {
    setIndex((i) => clamp(i + delta));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    startX.current = e.clientX;
    dragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current || startX.current === null) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      go(dx < 0 ? 1 : -1);
    }
    dragging.current = false;
    startX.current = null;
  }
  function onPointerCancel() {
    dragging.current = false;
    startX.current = null;
  }

  return (
    <div className="relative">
      <div
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="touch-pan-y select-none overflow-hidden rounded-md border border-bg-border/40"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt={`${label} — variant ${index + 1} of ${images.length}`}
          draggable={false}
          className="block w-full"
        />
      </div>

      <button
        type="button"
        onClick={() => go(-1)}
        disabled={index === 0}
        aria-label="Previous variant"
        className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-bg-base/80 p-1.5 text-ink-200 ring-1 ring-bg-border/60 backdrop-blur transition-colors hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        disabled={index === images.length - 1}
        aria-label="Next variant"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-bg-base/80 p-1.5 text-ink-200 ring-1 ring-bg-border/60 backdrop-blur transition-colors hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Go to variant ${i + 1}`}
            className={
              "h-1.5 rounded-full transition-all " +
              (i === index ? "w-4 bg-sv-sky" : "w-1.5 bg-bg-border hover:bg-ink-500")
            }
          />
        ))}
      </div>
    </div>
  );
}
