import { PageView, type TabSearchParams } from "../page-view";

export const metadata = { title: "Organisation settings" };

export default function Page({ searchParams }: { searchParams: TabSearchParams }) {
  return <PageView pageKey="settings" searchParams={searchParams} />;
}
