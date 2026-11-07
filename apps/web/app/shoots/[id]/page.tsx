import { Wizard } from "../../../components/wizard";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Wizard id={(await params).id} />;
}
