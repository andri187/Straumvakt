import type { Route } from "next";
import { redirect } from "next/navigation";

// The Organisations menu entry was replaced by Organisation settings; keep the
// earlier address working without exposing anything new.
export default function Page() {
  redirect("/cpo/settings" as Route);
}
