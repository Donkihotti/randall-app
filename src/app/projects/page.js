// src/app/photoshoots/page.jsx
import PageLayout from "../components/PageLayout/PageLayout";
import ProjectsList from "../components/projects/ProjectsList";

export default function Page() {
  return (
    <PageLayout className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <ProjectsList />
      </div>
    </PageLayout>
  );
}
