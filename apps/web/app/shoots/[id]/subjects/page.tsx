import { InputWorkspace } from "../../../../components/input-workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <InputWorkspace shootId={(await params).id} />;
}
