import { PlanStudio } from "../../../../components/plan-studio";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PlanStudio shootId={(await params).id} />;
}
