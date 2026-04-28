import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { AppScreenshotCarousel } from "./carousel";

export const metadata = { title: "Mobile App" };

// Side-by-side gallery of the driver-app screenshots captured at the
// designed flow — Login → Start charge (3 hero variants) → Prechecks →
// Active charging. Position 01 (Start charge) carries three hero
// variants and is rendered as a swipe carousel; the other positions
// are single static frames.
//
// Source images live in docs/app/ for reference and are mirrored into
// public/app-screenshots/ so the worker can serve them.

const FRAMES: Frame[] = [
  {
    label: "Login",
    images: ["/app-screenshots/00_login_pixel9.png"],
  },
  {
    label: "Start charge",
    images: [
      "/app-screenshots/01_start_charge_after_login_pixel9.png",
      "/app-screenshots/01_start_hero_2_on_pixel9.png",
      "/app-screenshots/01_start_hero_3_isorka_pixel9.png",
    ],
  },
  {
    label: "Prechecks",
    images: ["/app-screenshots/02_prechecks_pixel9.png"],
  },
  {
    label: "Active charging",
    images: ["/app-screenshots/03_active_charging_pixel9.png"],
  },
];

type Frame = {
  label: string;
  images: string[];
};

export default async function MobileAppPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  return (
    <>
      <Topbar title="Mobile App" email={session?.email} />
      <PageShell
        title="Mobile App"
        description="Designed driver-app flow — Pixel 9 frames captured at four key states. Swipe through the Start charge variants to see the hero alternates."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FRAMES.map((frame, i) => (
            <FramePanel key={i} index={i} frame={frame} />
          ))}
        </div>
      </PageShell>
    </>
  );
}

function FramePanel({ index, frame }: { index: number; frame: Frame }) {
  const idx = String(index).padStart(2, "0");
  const isCarousel = frame.images.length > 1;
  return (
    <figure className="rounded-lg border border-bg-border bg-bg-surface/70 p-3 shadow-card backdrop-blur">
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] text-ink-500">{idx}</span>
        <span className="text-xs font-semibold text-ink-100">{frame.label}</span>
        <span className="font-mono text-[10px] text-ink-500">
          {isCarousel ? `${frame.images.length} variants` : "static"}
        </span>
      </figcaption>
      {isCarousel ? (
        <AppScreenshotCarousel images={frame.images} label={frame.label} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame.images[0]}
          alt={frame.label}
          className="block w-full rounded-md border border-bg-border/40"
        />
      )}
    </figure>
  );
}
