// src/app/model/[id]/page.jsx
import PageLayout from "@/app/components/PageLayout/PageLayout";
import ModelViewer from "./ModelViewer";
import Link from "next/link";

const navLinks = [
  { name: 'Dashboard', path: '/dashboard'},
  { name: '/Models', path: '/models'},
  { name: '/Model', path: '/models'},
]

export default async function Page({ params }) {
  // Await params per Next.js guidance
  const resolvedParams = await params;
  const resolvedId = resolvedParams?.id ?? null;

  // Server-side log (visible in terminal)
  console.log("[page] resolvedParams:", resolvedParams);
  console.log("[page] resolvedId:", resolvedId);

  return (
    <PageLayout className="min-h-screen w-full">
      <div className="flex flex-row">
        {navLinks.map((nav, i ) => ( 
          <Link href={nav.path} key={i} className="text-app-nav mb-4">{nav.name}</Link>
        ))}
      </div>
      <div className="max-w-full py-8">
        <ModelViewer id={resolvedId} />
      </div>
    </PageLayout>
  );
}
