"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

  if (loading) return <div className="p-4">Loading projects…</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!projects.length) return <div className="p-4">No projects yet — create one!</div>;

  return (
    <div className="space-y-4 p-4">
      {projects.map(p => (
        <div key={p.id} className="bg-white p-4 rounded shadow-sm flex justify-between items-center">
          <div>
            <div className="text-lg font-medium">{p.name}</div>
            <div className="text-xs text-gray-500">{p.description}</div>
            <div className="text-xs text-gray-400 mt-1">Created: {new Date(p.created_at).toLocaleString()}</div>
          </div>
          <div>
            <button onClick={() => router.push(`/project/${p.id}/dashboard`)} className="px-3 py-1 border rounded">
              Open
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
