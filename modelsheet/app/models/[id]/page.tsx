import { ModelPage } from "@/components/ModelPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModelPage id={id} />;
}
