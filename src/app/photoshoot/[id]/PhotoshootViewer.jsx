"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FetchLoader from "@/app/components/loaders/FetchLoader";

/**
 * PhotoshootViewer
 * - prop: id (string) - photoshoot id
 * - fetches GET /api/photoshoots/{id} with credentials: 'include'
 * - displays assets (images) and Open link + Copy URL
 * - refreshes signed URLs automatically shortly before they expire
 * - polls jobs every 5s (stops when component unmounts)
 */

export default function PhotoshootViewer({ id }) {
  const [loading, setLoading] = useState(true);
  const [photoshoot, setPhotoshoot] = useState(null);
  const [assets, setAssets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const refreshTimerRef = useRef(null);
  const jobsPollRef = useRef(null);
  const mountedRef = useRef(true);
  const router = useRouter();

  // resolve id shape (Next can pass object)
  const resolveId = (raw) => {
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    if (typeof raw === "object") return raw.id ?? raw._id ?? raw.photoshootId ?? null;
    return null;
  };

  const resolvedId = resolveId(id);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!resolvedId) {
      setError("Missing photoshoot id");
      setLoading(false);
      return;
    }

    let mounted = true;
    async function fetchPhotoshoot() {
      console.log("[PhotoshootViewer] fetchPhotoshoot start", { resolvedId });
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/photoshoots/${encodeURIComponent(resolvedId)}`, {
          method: "GET",
          credentials: "include", // IMPORTANT: send HttpOnly cookies
          cache: "no-store",
        });

        console.log("[PhotoshootViewer] raw response", { status: res.status, statusText: res.statusText });

        // parse json safely
        let json = null;
        try {
          json = await res.json();
        } catch (parseErr) {
          console.error("[PhotoshootViewer] failed to parse JSON", parseErr);
          const text = await res.text().catch(() => "(no body)");
          console.error("[PhotoshootViewer] response text:", text);
          throw new Error("Invalid JSON from server");
        }

        console.log("[PhotoshootViewer] parsed json", json);

        if (!res.ok) {
          throw new Error(json?.error || `API ${res.status}`);
        }

        const fetchedPhotoshoot = json.photoshoot ?? null;
        const fetchedAssets = Array.isArray(json.assets) ? json.assets : [];
        const fetchedJobs = Array.isArray(json.jobs) ? json.jobs : [];

        if (mounted) {
          setPhotoshoot(fetchedPhotoshoot);
          setAssets(fetchedAssets);
          setJobs(fetchedJobs);
        }

        // compute when to refresh signed urls:
        scheduleSignedUrlRefresh(fetchedAssets || []);
      } catch (err) {
        console.error("[PhotoshootViewer] fetchPhotoshoot error", err);
        if (mounted) setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
        console.log("[PhotoshootViewer] fetchPhotoshoot finished");
      }
    }

    // clear any existing timers
    clearRefreshTimer();
    clearJobsPoll();

    fetchPhotoshoot();

    // start jobs polling
    jobsPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/photoshoots/${encodeURIComponent(resolvedId)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (!json) return;
        if (mounted) {
          if (Array.isArray(json.jobs)) {
            setJobs(json.jobs);
          }
        }
      } catch (e) {
        // non-fatal
      }
    }, 5000);

    return () => {
      mounted = false;
      clearRefreshTimer();
      clearJobsPoll();
    };
  }, [resolvedId]); // refetch when id changes

  function clearRefreshTimer() {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  function clearJobsPoll() {
    if (jobsPollRef.current) {
      clearInterval(jobsPollRef.current);
      jobsPollRef.current = null;
    }
  }

  // schedule a refresh just before the earliest expiry (30s buffer)
  function scheduleSignedUrlRefresh(currentAssets) {
    clearRefreshTimer();
    if (!Array.isArray(currentAssets) || currentAssets.length === 0) return;

    const withExpiry = currentAssets
      .map(a => ({ ...a, expires_at_ts: a.expires_at ? Date.parse(a.expires_at) : null }))
      .filter(a => a.expires_at_ts && !Number.isNaN(a.expires_at_ts));

    if (withExpiry.length === 0) return;

    const earliest = withExpiry.reduce((min, a) => (a.expires_at_ts < min ? a.expires_at_ts : min), withExpiry[0].expires_at_ts);
    const now = Date.now();
    // refresh 30 seconds before expiry (clamp)
    const bufferMs = 30 * 1000;
    const msUntilRefresh = Math.max(1000, earliest - now - bufferMs); // at least 1s
    console.log("[PhotoshootViewer] scheduling signed-url refresh in ms:", msUntilRefresh, { earliest: new Date(earliest).toISOString() });

    refreshTimerRef.current = setTimeout(() => {
      console.log("[PhotoshootViewer] refreshing signed URLs now");
      // re-run the fetch to get fresh signed urls
      // don't replace state if component unmounted
      (async () => {
        try {
          const res = await fetch(`/api/photoshoots/${encodeURIComponent(resolvedId)}`, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok) {
            console.warn("[PhotoshootViewer] refresh fetch returned not ok", res.status);
            return;
          }
          const json = await res.json().catch(() => null);
          if (!json) return;
          if (mountedRef.current) {
            setAssets(Array.isArray(json.assets) ? json.assets : []);
            setJobs(Array.isArray(json.jobs) ? json.jobs : []);
            setPhotoshoot(json.photoshoot ?? null);
            // schedule next refresh
            scheduleSignedUrlRefresh(Array.isArray(json.assets) ? json.assets : []);
          }
        } catch (e) {
          console.error("[PhotoshootViewer] error during signed-url refresh", e);
        }
      })();
    }, msUntilRefresh);
  }

  async function handleCopyUrl(url, id) {
    try {
      await navigator.clipboard.writeText(url);
      console.log("[PhotoshootViewer] copied asset url", id);
      alert("Copied asset URL to clipboard (debug)");
    } catch (e) {
      console.warn("[PhotoshootViewer] copy failed", e);
    }
  }

  if (loading) return <div className=""><FetchLoader/></div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!photoshoot) return <div className="p-6">No photoshoot data.</div>;
  if (!assets.length) return (
    <div className="w-full h-96 border rounded-xs border-normal border-dashed flex items-center justify-center">
        <p className="text-small font-semibold">No images created for this photoshoot.</p>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{photoshoot.name}</h2>
          <div className="text-sm text-gray-500">Status: {photoshoot.status}</div>
        </div>
        <div>
          <button className="px-3 py-1 border rounded" onClick={() => router.push(`/photoshoot/${photoshoot.id}/dashboard`)}>
            Dashboard
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {assets.map((a) => (
          <div key={a.id} className="bg-white rounded shadow-sm overflow-hidden border">
            {a.url ? (
              <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
                <img
                  src={a.url}
                  alt={a.meta?.filename || a.filename || a.id}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error("[PhotoshootViewer] image failed to load", { assetId: a.id, url: a.url });
                    e.currentTarget.style.objectFit = "contain";
                  }}
                />
              </div>
            ) : (
              <div className="p-4 h-48 flex items-center justify-center">
                <div className="text-sm text-gray-500">No URL available</div>
              </div>
            )}

            <div className="p-3">
              <div className="text-sm font-medium">{a.meta?.filename || a.filename || a.id}</div>
              <div className="text-xs text-gray-500 mt-1">{a.meta?.description || a.mimetype || "Asset"}</div>
              <div className="text-xs text-gray-400 mt-1">Expires: {a.expires_at ?? "—"}</div>

              <div className="mt-3 flex gap-2">
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-1 border rounded text-white bg-blue-600 hover:bg-blue-700"
                    onClick={() => console.log("[PhotoshootViewer] Open asset clicked", a.id)}
                  >
                    Open
                  </a>
                ) : (
                  <button className="text-xs px-2 py-1 border rounded text-gray-400 cursor-not-allowed">Open</button>
                )}

                <button
                  onClick={() => a.url && handleCopyUrl(a.url, a.id)}
                  className="text-xs px-2 py-1 border rounded"
                >
                  Copy URL
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium">Jobs</h3>
        {jobs.length ? (
          <ul className="text-sm text-gray-700 mt-2">
            {jobs.map((j) => (
              <li key={j.id} className="mb-1">
                {j.id} — {j.status} — created: {j.created_at ? new Date(j.created_at).toLocaleString() : "—"}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-500 mt-2">No recent jobs</div>
        )}
      </div>
    </div>
  );
}
