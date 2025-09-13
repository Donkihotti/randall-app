// src/app/photoshoots/page.jsx
import PageLayout from "../components/PageLayout/PageLayout";
import PhotoshootsList from "../components/photoshoots/PhotoshootsList";

export default function Page() {
  return (
    <PageLayout className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Your Photoshoots</h1>
        <PhotoshootsList />
      </div>
    </PageLayout>
  );
}
