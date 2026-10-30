import { PageView, type TabSearchParams } from "../page-view";

export const metadata = { title: "Sessions" };

export default function Page({ searchParams }: { searchParams: TabSearchParams }) {
  return <PageView pageKey="sessions" searchParams={searchParams} />;
}
