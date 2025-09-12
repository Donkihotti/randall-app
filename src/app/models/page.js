// src/app/models/page.client.jsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import PageLayout from "../components/PageLayout/PageLayout";

const navLinks = [
    { name: 'Dashboard', path: '/dashboard'},
    { name: '/Models', path: '/models'},
  ]

export default function ModelsPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function fetchModels() {
      console.log("[ModelsPage] fetching /api/models (cookies)");
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/models", {
          method: "GET",
          credentials: "include", // important: send HttpOnly cookies
          cache: "no-store",
        });

        console.log("[ModelsPage] /api/models status:", res.status);
        const json = await res.json().catch((e) => {
          console.error("[ModelsPage] failed to parse json", e);
          throw e;
        });
        console.log("[ModelsPage] /api/models json:", json);

        if (!res.ok) {
          throw new Error(json?.error || `API error ${res.status}`);
        }

        // normalize rows: ensure asset_ids are arrays
        const normalized = (json.models || []).map((r) => {
          let asset_ids = r.asset_ids ?? [];
          if (typeof asset_ids === "string") {
            try { asset_ids = JSON.parse(asset_ids); } catch (e) { asset_ids = []; }
          }
          if (!Array.isArray(asset_ids)) asset_ids = [];
          return { ...r, asset_ids };
        });

        if (mounted) setModels(normalized);
      } catch (err) {
        console.error("[ModelsPage] load error", err);
        if (mounted) setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchModels();
    return () => { mounted = false; };
  }, []);

  return (
    <PageLayout>
      <div className="flex items-center justify-between">
        <div className="flex flex-row">
            {navLinks.map((nav, i ) => ( 
            <Link href={nav.path} key={i} className="text-app-nav mb-4">{nav.name}</Link>
            ))}
        </div>
      </div>

      {loading && <div className="mt-4">Loading…</div>}
      {error && <div className="mt-4 text-red-600">Error: {error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 mt-6">
        {models.map((m) => (
          <Link key={m.id} href={`/model/${m.id}`} className="block">
            <div className="box-bg-normal p-3 flex gap-3 hover:border-lighter transition">
              <div className="w-28 h-20 bg-gray-100 rounded overflow-hidden flex items-center justify-center">
                {m.thumbnail_url ? (
                  // Next/Image expects absolute URL allowed by next.config for external hosts,
                  // or use <img> if the signedURL is from a different origin. Using Image is fine if allowed.
                  <Image
                    src={m.thumbnail_url}
                    alt={m.name || "thumbnail"}
                    width={160}
                    height={120}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <div className="text-xs text-gray-600 px-2 text-center">No preview</div>
                )}
              </div>

              <div className="flex-1">
                <div className="font-semibold text-small text-white">{m.name || "Untitled"}</div>
                <div className="text-sm text-gray-500 mt-1">Assets: {Array.isArray(m.asset_ids) ? m.asset_ids.length : "?"}</div>
                <div className="text-xs text-gray-400 mt-2">{new Date(m.created_at).toLocaleString()}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </PageLayout>
  );
}
