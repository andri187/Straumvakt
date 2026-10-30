import { PageView, type TabSearchParams } from "../page-view";

export const metadata = { title: "People & access" };

export default function Page({ searchParams }: { searchParams: TabSearchParams }) {
  return <PageView pageKey="people" searchParams={searchParams} />;
}
