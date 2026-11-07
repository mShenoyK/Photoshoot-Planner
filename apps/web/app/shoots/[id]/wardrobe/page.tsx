import { StylingStudio } from "../../../../components/styling-studio";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <StylingStudio shootId={(await params).id} mode="wardrobe" />;
}
