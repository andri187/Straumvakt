"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const SWIPE_THRESHOLD_PX = 40;

export function AppScreenshotCarousel({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  const clamp = (n: number) => Math.max(0, Math.min(images.length - 1, n));

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    startX.current = e.clientX;
    dragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current || startX.current === null) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      setIndex((i) => clamp(i + (dx < 0 ? 1 : -1)));
    }
    dragging.current = false;
    startX.current = null;
  }
  function onPointerCancel() {
    dragging.current = false;
    startX.current = null;
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="touch-pan-y select-none"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[index]}
        alt=""
        draggable={false}
        className="block w-full"
      />
    </div>
  );
}
