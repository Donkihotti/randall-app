// server component page — simply renders the client editor and passes params.id
import PageLayout from "@/app/components/PageLayout/PageLayout";
import PhotoshootEditorClient from "@/app/components/photoshoots/PhotoshootEditorClient";

export default async function Page({ params }) {
    const { id } = await params;
  return (
    <PageLayout>
        <div className="w-full h-full relative">
        <h1 className="text-2xl font-semibold mb-4">Photoshoot Studio</h1>
        <div className="absolute bottom-3.5 w-full">
        <PhotoshootEditorClient photoshootId={id} />
        </div>
        </div>
    </PageLayout>
  );
}
