// src/app/photoshoots/page.jsx
import PageLayout from "../components/PageLayout/PageLayout";
import ProjectsList from "../components/projects/ProjectsList";

export default function Page() {
  return (
    <PageLayout className="min-h-screen">
      <div className="max-w-full">
        <p className="text-lg md:text-xl text-white font-medium">Projects</p>
        <div className="mt-7">
         <ProjectsList/>
        </div>
      </div>
    </PageLayout>
  );
}
