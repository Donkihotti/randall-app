"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import FetchLoader from "../loaders/FetchLoader";

export default function ProjectsList() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects", { method: "GET", credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || `API ${res.status}`);
        if (mounted) setProjects(Array.isArray(json.projects) ? json.projects : []);
      } catch (err) {
        console.error("[ProjectsList] error", err);
        if (mounted) setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  if (loading) return <div className="w-full h-full relative"><FetchLoader/></div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!projects.length) return <div className="p-4">No projects yet — create one!</div>;

  return (
    <div className="space-y-3 h-full">
      {projects.map(p => (
        <div key={p.id} className="box-bg-normal p-1.5 flex items-center flex-row relative gap-x-2">
        <div className="absolute top-3 right-3 border-light hover:border hover:border-light px-3 py-1">
          
        </div>
        <div className="w-2/5 h-24 bg-light rounded-xs"></div>
          <div className="flex h-24 flex-col">
            <div className="text-small font-semibold">{p.name}</div>
           
          </div>
          <div>
            <button onClick={() => router.push(`/project/${p.id}/dashboard`)} className="button-normal-h-light pl-1.5 flex items-center gap-x-1 justify-center font-semibold absolute bottom-1.5 right-1.5">
              <Image 
                src={'More_Grid_Small.svg'}
                alt="edit icon"
                height={20}
                width={20}
                />
                Open
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
