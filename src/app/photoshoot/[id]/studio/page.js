// server component page — simply renders the client editor and passes params.id
import PageLayout from "@/app/components/PageLayout/PageLayout";
import PhotoshootEditorClient from "@/app/components/photoshoots/PhotoshootEditorClient";

export default function PhotoshootStudioPage({ params }) {
  const id = params?.id;
  return (
    <PageLayout>
        <div className="w-full h-full ">
        <h1 className="text-2xl font-semibold mb-4">Photoshoot Studio</h1>
        <p className="text-sm text-gray-600 mb-6">Create new images for this photoshoot / tweak generation settings.</p>
        <PhotoshootEditorClient photoshootId={id} />
        </div>
    </PageLayout>
  );
}
