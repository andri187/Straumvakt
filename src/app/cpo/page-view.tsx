import { ContextBar, Note, PageHeader, TabBody, TabNav, UnconnectedBanner } from "./workspace-ui";
import { getShellPage, resolveTab, type ShellPage } from "./sections";

export type TabSearchParams = Promise<{ tab?: string | string[] }>;

export async function PageView({
  pageKey,
  searchParams,
}: {
  pageKey: ShellPage["key"];
  searchParams: TabSearchParams;
}) {
  const page = getShellPage(pageKey);
  const { tab: rawTab } = await searchParams;
  const tab = resolveTab(page, rawTab);

  return (
    <>
      <ContextBar />
      <UnconnectedBanner />
      <PageHeader
        title={page.title}
        subtitle={page.subtitle}
        action={tab.action}
        actionId={`${page.key}-${tab.key}`}
      />
      <TabNav page={page} active={tab} />
      {tab.note ? <Note>{tab.note}</Note> : null}
      <TabBody content={tab.content} />
    </>
  );
}
