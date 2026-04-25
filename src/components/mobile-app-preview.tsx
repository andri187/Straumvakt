"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Lightweight presentation of the driver-app mobile preview.
 *
 * Replaces the Flutter Web iframe with a small native carousel of
 * the four hero images. Same files, served from public/mobile-app-mock/
 * via the existing sync script — no Flutter framework, no service
 * worker, no 49 MB main.dart.js.
 *
 * Slides auto-advance; click any dot to jump; keyboard ←/→ also works
 * when the frame is focused.
 */
const HERO_IMAGES: { src: string; alt: string; caption: string }[] = [
  {
    src: "/mobile-app-mock/assets/assets/images/straumvakt_hero_image.png",
    alt: "Straumvakt",
    caption: "Straumvakt",
  },
  {
    src: "/mobile-app-mock/assets/assets/images/n1_hero_image.png",
    alt: "N1",
    caption: "N1 · partner network",
  },
  {
    src: "/mobile-app-mock/assets/assets/images/isorka_hero_image.png",
    alt: "Ísorka",
    caption: "Ísorka · partner network",
  },
  {
    src: "/mobile-app-mock/assets/assets/images/on_hero_image.png",
    alt: "ON",
    caption: "ON · partner network",
  },
];

const ADVANCE_MS = 4000;

export function MobileAppPreview() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % HERO_IMAGES.length);
    }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  function go(i: number) {
    setIndex(((i % HERO_IMAGES.length) + HERO_IMAGES.length) % HERO_IMAGES.length);
  }

  return (
    <div
      className="flex justify-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        role="region"
        aria-label="Mobile app preview"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(index - 1);
          if (e.key === "ArrowRight") go(index + 1);
        }}
        className={cn(
          "relative w-[320px] overflow-hidden rounded-[40px] border border-bg-border bg-bg-base shadow-card",
          // 19.5:9 aspect ratio with padding for the notch/home pill
          "aspect-[9/19.5]",
        )}
      >
        {/* Notch */}
        <div className="absolute left-1/2 top-3 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black/80" />

        {/* Slides */}
        <div className="absolute inset-0">
          {HERO_IMAGES.map((img, i) => (
            <div
              key={img.src}
              className={cn(
                "absolute inset-0 transition-opacity duration-700 ease-in-out",
                i === index ? "opacity-100" : "opacity-0",
              )}
              aria-hidden={i !== index}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.alt}
                className="h-full w-full object-cover"
                draggable={false}
              />
              {/* Caption — bottom gradient + label */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-5 pb-12 pt-16">
                <div className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                  Hero
                </div>
                <div className="mt-0.5 text-base font-semibold text-white drop-shadow">
                  {img.caption}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Nav dots */}
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
          {HERO_IMAGES.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}: ${img.caption}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index
                  ? "w-6 bg-white"
                  : "w-1.5 bg-white/40 hover:bg-white/60",
              )}
            />
          ))}
        </div>

        {/* Home pill */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1.5">
          <div className="h-1 w-24 rounded-full bg-white/30" />
        </div>
      </div>
    </div>
  );
}
