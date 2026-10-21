import { notFound } from "next/navigation";
import { VisualStudio } from "./visual-studio";
import "./visual.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visual workspace" };

export default function VisualWorkspacePage() {
  if (process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1") notFound();
  return <VisualStudio />;
}
