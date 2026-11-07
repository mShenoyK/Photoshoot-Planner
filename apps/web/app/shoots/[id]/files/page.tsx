import { AssetLibrary } from "../../../../components/asset-library";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <AssetLibrary shootId={(await params).id} />;
}
