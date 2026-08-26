import type { Metadata } from "next";

import { IssueDetail } from "@/components/tracebox/issue-detail";

export const metadata: Metadata = { title: "Issue detail" };

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IssueDetail issueId={id} />;
}
