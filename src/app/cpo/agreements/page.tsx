import { PageView, type TabSearchParams } from "../page-view";

export const metadata = { title: "Agreements & sponsorship" };

export default function Page({ searchParams }: { searchParams: TabSearchParams }) {
  return <PageView pageKey="agreements" searchParams={searchParams} />;
}
