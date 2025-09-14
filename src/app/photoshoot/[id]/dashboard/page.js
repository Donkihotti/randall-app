// src/app/photoshoot/[id]/dashboard/page.jsx
import PhotoshootViewer from "../PhotoshootViewer";
import PageLayout from "@/app/components/PageLayout/PageLayout";
import PhotoshootDashboardClient from "../PhotoshootDashboardClient";

export default async function Page({ params }) {
  const resolvedParams = await params;
  const id = resolvedParams?.id ?? null;
  console.log("[page.photoshoot.dashboard] resolvedParams:", resolvedParams, "id:", id);

  return (
    <PageLayout className="min-h-screen">
      <div className="w-full mx-auto h-full py-8">
        <h1 className="text-2xl font-semibold mb-4">Photoshoot</h1>
        <div className="w-full">
          {/* pass string id down to client */}
          <PhotoshootViewer id={id} />
          <PhotoshootDashboardClient id={id} />
        </div>
      </div>
    </PageLayout>
  );
}
