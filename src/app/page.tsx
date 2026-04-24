import { redirect } from "next/navigation";

export default function RootPage() {
  // Always start with login; middleware redirects authenticated admins to /dashboard.
  redirect("/login");
}
