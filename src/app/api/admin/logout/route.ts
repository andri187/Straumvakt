import { NextResponse } from "next/server";
import { adminSessionConfig } from "@/lib/admin-session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: adminSessionConfig.SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    expires: new Date(0),
  });
  return res;
}
