import { notFound } from "next/navigation";
import { DsoLookup } from "./dso-lookup-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Local DSO lookup" };

export default function LocalDsoLookupPage() {
  if (process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1") notFound();
  return <DsoLookup />;
}
