import { AppScreenshotCarousel } from "./carousel";

export const metadata = { title: "Mobile App" };

const FRAME_00 = "/app-screenshots/00_login_pixel9.png";
const FRAME_01 = [
  "/app-screenshots/01_start_charge_after_login_pixel9.png",
  "/app-screenshots/01_start_hero_2_on_pixel9.png",
  "/app-screenshots/01_start_hero_3_isorka_pixel9.png",
];
const FRAME_02 = "/app-screenshots/02_prechecks_pixel9.png";
const FRAME_03 = "/app-screenshots/03_active_charging_pixel9.png";

export default function MobileAppPage() {
  return (
    <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={FRAME_00} alt="" className="block w-full" />
      <AppScreenshotCarousel images={FRAME_01} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={FRAME_02} alt="" className="block w-full" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={FRAME_03} alt="" className="block w-full" />
    </div>
  );
}
