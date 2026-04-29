import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import type { PropertySummary } from "@straumvakt/shared/domain/properties";
import { EditPropertyPanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/properties/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { property } = (await res.json()) as { property: PropertySummary };

  const addr = (property.address ?? {}) as Record<string, string | undefined>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/tenants/properties" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to properties
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">{property.displayName}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Property under{" "}
          <Link href={`/tenants/organizations/${property.orgId}`} className="text-sv-sky hover:underline">
            {property.orgDisplayName}
          </Link>
          {property.locationType && <span className="ml-2 font-mono text-ink-500">{property.locationType}</span>}
        </p>
        <p className="mt-1 font-mono text-[10px] text-ink-500">{property.id}</p>
      </header>

      <EditPropertyPanel
        propertyId={property.id}
        initial={{
          displayName: property.displayName,
          locationType: property.locationType ?? "",
          street: addr.street ?? "",
          city: addr.city ?? "",
          postalCode: (addr["postal_code"] as string | undefined) ?? "",
          countryCode: (addr.country as string | undefined) ?? "IS",
          latitude: property.latitude ?? "",
          longitude: property.longitude ?? "",
        }}
      />
    </div>
  );
}
