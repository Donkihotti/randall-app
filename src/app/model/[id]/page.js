// src/app/model/[id]/page.jsx
import PageLayout from "@/app/components/PageLayout/PageLayout";
import ModelViewer from "./ModelViewer";

export default async function Page({ params }) {
  // Await params per Next.js guidance
  const resolvedParams = await params;
  const resolvedId = resolvedParams?.id ?? null;

  // Server-side log (visible in terminal)
  console.log("[page] resolvedParams:", resolvedParams);
  console.log("[page] resolvedId:", resolvedId);

  return (
    <PageLayout className="min-h-screen">
      <div className="max-w-5xl mx-auto py-8">
        <h1 className="text-2xl font-semibold mb-4">Model</h1>
        {/* Pass a string id down to the client component */}
        <ModelViewer id={resolvedId} />
      </div>
    </PageLayout>
  );
}
