import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DemoAppIndexPage() {
  if (process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1") notFound();
  redirect("/login-demo" as Route);
}
