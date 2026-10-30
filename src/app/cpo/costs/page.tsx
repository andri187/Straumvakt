import { PageView, type TabSearchParams } from "../page-view";

export const metadata = { title: "Cost factors & rates" };

export default function Page({ searchParams }: { searchParams: TabSearchParams }) {
  return <PageView pageKey="costs" searchParams={searchParams} />;
}
