import { ToolWorkspace } from "../../../../components/tool-workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  return <ToolWorkspace id={id} kind={kind} />;
}
