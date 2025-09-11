// src/app/model/[id]/ModelViewer.jsx
"use client";

import { useEffect, useState } from "react";

/**
 * ModelViewer client component
 * - Expects prop id (string). If id is an object, will attempt to resolve.
 * - Fetches /api/models/{id} with credentials included (HttpOnly cookie auth).
 * - Displays returned assets: each asset should be { id, url, meta }.
 * - Shows clickable "Open" link (opens in new tab) and logs clicks for debugging.
 */

export default function ModelViewer({ id }) {
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    // helpful logging about id prop shape (sometimes Next passes object)
    console.log("[ModelViewer] received id prop:", id);
    let resolvedId = id;
    if (typeof id === "object" && id !== null) {
      // attempt common keys
      resolvedId = id.id ?? id._id ?? id.modelId ?? null;
      console.log("[ModelViewer] resolved id from object:", resolvedId);
    }

    if (!resolvedId || typeof resolvedId !== "string") {
      console.error("[ModelViewer] invalid model id; aborting fetch");
      setError("Missing or invalid model id");
      setLoading(false);
      return;
    }

    let mounted = true;

    async function fetchModelAssets() {
      console.log("[ModelViewer] fetchModelAssets start", { resolvedId });
      setLoading(true);
      setError(null);

      try {
        const url = `/api/models/${encodeURIComponent(resolvedId)}`;
        console.log("[ModelViewer] fetching url:", url);

        const res = await fetch(url, {
          method: "GET",
          credentials: "include", // IMPORTANT: send HttpOnly cookies to server
          cache: "no-store",
        });

        console.log("[ModelViewer] raw response", { status: res.status, statusText: res.statusText });

        const json = await res.json().catch((e) => {
          console.error("[ModelViewer] failed to parse JSON", e);
          throw e;
        });

        console.log("[ModelViewer] response JSON", json);

        if (!res.ok) {
          const msg = json?.error || `API error ${res.status}`;
          throw new Error(msg);
        }

        // The API returns { ok: true, id, name, assets: [{id, url, meta}, ...] }
        const returnedAssets = Array.isArray(json.assets) ? json.assets : [];
        console.log("[ModelViewer] assets count:", returnedAssets.length);

        // Basic validation: ensure each asset has id and url (url may be null)
        const normalized = returnedAssets.map((a) => ({
          id: a.id,
          url: a.url ?? null,
          meta: a.meta ?? {},
        }));

        if (mounted) {
          setAssets(normalized);
        }
      } catch (err) {
        console.error("[ModelViewer] fetchModelAssets error", err);
        if (mounted) setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
        console.log("[ModelViewer] fetchModelAssets finished");
      }
    }

    fetchModelAssets();

    return () => { mounted = false; };
  }, [id]);

  if (loading) return <div className="p-6">Loading assets…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!assets.length) return <div className="p-6">No assets in this collection.</div>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4">
      {assets.map((a) => (
        <div key={a.id} className="box-bg-normal overflow-hidden">
          {a.url ? (
            <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
              {/* Use a plain img tag because signed URLs may be external. If you prefer Next/Image,
                  add the signed URL host to next.config.js images.domains */}
              <img
                src={a.url}
                alt={a.meta?.filename || a.id}
                className="w-full h-full object-cover"
                onError={(e) => {
                  console.error("[ModelViewer] image failed to load", { assetId: a.id, url: a.url, err: e });
                  // adjust style so the broken image doesn't stretch
                  e.currentTarget.style.objectFit = "contain";
                }}
              />
            </div>
          ) : (
            <div className="p-4 h-48 flex items-center justify-center">
              <div className="text-sm text-gray-500">No URL available for asset {a.id}</div>
            </div>
          )}

          <div className="p-3">
            <div className="text-sm font-medium">{a.meta?.filename || a.id}</div>
            <div className="text-xs text-gray-500 mt-1">{a.meta?.description || a.meta?.type || "Asset"}</div>

            <div className="mt-3 flex gap-2">
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs inline-block px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                  onClick={() => console.log("[ModelViewer] user clicked Open asset", a.id)}
                >
                  Open
                </a>
              ) : (
                <button
                  className="text-xs px-2 py-1 border rounded text-gray-400 cursor-not-allowed"
                  title="No URL available"
                >
                  Open
                </button>
              )}

              <button
                className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  console.log("[ModelViewer] debug: copy asset url to clipboard", a.id, a.url);
                  if (a.url) navigator.clipboard?.writeText(a.url).then(() => {
                    console.log("[ModelViewer] copied url for", a.id);
                    alert("Asset URL copied to clipboard (debug)");
                  }).catch((e) => {
                    console.warn("[ModelViewer] failed to copy url", e);
                  });
                }}
              >
                Copy URL
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
