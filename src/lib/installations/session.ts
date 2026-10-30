// Server-component helper: the verified shared-login actor, or null.
//
// Pages do not rely on the /cpo layout or middleware for authorisation (a
// layout and its page render independently); each data-reading page calls this.

import { headers } from "next/headers";
import { readShellCookie } from "@/lib/cpo-shell-policy";
import { verifyShellSession } from "@/lib/cpo-shell-session";
import { sharedLoginActor, type Actor } from "./actor";

export async function currentActor(): Promise<Actor | null> {
  const session = await verifyShellSession(readShellCookie((await headers()).get("cookie")));
  return session ? sharedLoginActor(session.username) : null;
}
