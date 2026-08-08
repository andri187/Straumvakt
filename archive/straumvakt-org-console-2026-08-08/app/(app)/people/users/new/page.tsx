import Link from "next/link";
import { CreateUserForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New user" };

export default function NewUserPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/people/users" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to users
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New user</h1>
        <p className="mt-1 text-sm text-ink-400">
          Required fields are marked with <span className="text-rose-400">*</span>.
          Email is the unique key. Display name optional. Pilot drivers
          left without a password — staff also start without one (admin
          session is env-var driven). Add memberships from the user
          detail page.
        </p>
      </header>
      <CreateUserForm />
    </div>
  );
}
