import { notFound } from "next/navigation";
import {
  getPostLoginFamily,
  getPostLoginPersona,
  getPostLoginScreen,
} from "../../post-login-data";
import { PostLoginShell } from "../../post-login-shell";
import "../../post-login.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Local post-login workspace" };

type RouteParams = Promise<{ persona: string; screen?: string[] }>;

export default async function PostLoginPage({ params }: { params: RouteParams }) {
  if (process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1") notFound();

  const route = await params;
  if ((route.screen?.length ?? 0) > 1) notFound();

  const persona = getPostLoginPersona(route.persona);
  if (!persona) notFound();

  const family = getPostLoginFamily(persona);
  const screen = getPostLoginScreen(family, route.screen?.[0]);
  if (!screen) notFound();

  return <PostLoginShell persona={persona} family={family} screen={screen} />;
}
