// src/app/photoshoot/[id]/studio/create-more/page.jsx
import PageLayout from "@/app/components/PageLayout/PageLayout";
import CreateMoreClient from "../../CreateMoreClient";

export default async function Page({ params, searchParams }) {
    const { id } = await params;
  return (
    <PageLayout>
      <div className="w-full h-full">
        <h1 className="text-2xl font-semibold mb-4">Photoshoot Studio — Create more</h1>
        <p className="text-sm text-gray-600 mb-6">Create additional variations from the selected base image.</p>
        <CreateMoreClient params={params} searchParams={searchParams} />
      </div>
    </PageLayout>
  );
}
