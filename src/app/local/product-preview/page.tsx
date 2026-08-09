import { notFound } from "next/navigation";
import { ProductPreview } from "./preview-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Local product preview" };

export default function LocalProductPreviewPage() {
  if (process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1") notFound();
  return <ProductPreview />;
}
