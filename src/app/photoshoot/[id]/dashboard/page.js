// src/app/photoshoot/[id]/dashboard/page.jsx
import PhotoshootViewer from "../PhotoshootViewer";
import PageLayout from "@/app/components/PageLayout/PageLayout";

export default async function Page({ params }) {
  const resolvedParams = await params;
  const id = resolvedParams?.id ?? null;
  console.log("[page.photoshoot.dashboard] resolvedParams:", resolvedParams, "id:", id);

  return (
    <PageLayout className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8">
        <h1 className="text-2xl font-semibold mb-4">Photoshoot</h1>
        <div className="w-full">
          {/* pass string id down to client */}
          <PhotoshootViewer id={id} />
        </div>
      </div>
    </PageLayout>
  );
}
