// src/app/photoshoot/[id]/PhotoshootDashboardClient.jsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ModelViewer from "@/app/model/[id]/ModelViewer";

export default function PhotoshootDashboardClient({ id }) {
  const [loading, setLoading] = useState(true);
  const [photoshoot, setPhotoshoot] = useState(null);
  const [assets, setAssets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);
  const refreshTimeoutRef = useRef(null);

  const fetchData = useCallback(async (opts = { force: false }) => {
    if (!id) return;
    console.log("[PhotoshootDashboard] fetchData start", { id, opts });
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/photoshoots/${encodeURIComponent(id)}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      console.log("[PhotoshootDashboard] raw response", { status: res.status, statusText: res.statusText });
      const json = await res.json().catch((e) => {
        console.error("[PhotoshootDashboard] failed parse json", e);
        throw e;
      });
      console.log("[PhotoshootDashboard] json", json);
      if (!res.ok) throw new Error(json?.error || `API ${res.status}`);
      setPhotoshoot(json.photoshoot || null);
      setAssets(Array.isArray(json.assets) ? json.assets : []);
      setJobs(Array.isArray(json.jobs) ? json.jobs : []);
      scheduleSignedUrlRefresh(Array.isArray(json.assets) ? json.assets : []);
    } catch (err) {
      console.error("[PhotoshootDashboard] fetchData error", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      console.log("[PhotoshootDashboard] fetchData finished");
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    // polling for job status (every 3s)
    pollRef.current = setInterval(() => {
      console.log("[PhotoshootDashboard] polling for updates");
      fetchData({ force: true });
    }, 3000);
    return () => {
      clearInterval(pollRef.current);
      clearTimeout(refreshTimeoutRef.current);
    };
  }, [fetchData]);

  function scheduleSignedUrlRefresh(assetList) {
    // find earliest expires_at and schedule a refresh 20s before expiry
    if (!assetList || !assetList.length) return;
    const expiries = assetList
      .map(a => a.expires_at ? new Date(a.expires_at).getTime() : null)
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!expiries.length) return;
    const earliest = expiries[0];
    const refreshAt = earliest - 20000; // 20s before expiry
    const now = Date.now();
    const ms = Math.max(1000, refreshAt - now);
    console.log("[PhotoshootDashboard] scheduling signed-url refresh in ms:", ms);
    clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      console.log("[PhotoshootDashboard] refreshing signed URLs before expiry");
      fetchData({ force: true });
    }, ms);
  }

  async function enqueueJob() {
    if (!id) return;
    console.log("[PhotoshootDashboard] enqueueJob start for photoshoot", id);
    try {
      // POST to your existing enqueue route
      const res = await fetch(`/api/photoshoots/${encodeURIComponent(id)}/jobs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots: 3 }), // add any parameters you want
      });
      const json = await res.json().catch(() => null);
      console.log("[PhotoshootDashboard] enqueue response", res.status, json);
      if (!res.ok) throw new Error(json?.error || `Create job failed (${res.status})`);
      // refresh immediately to pick up new job
      await fetchData({ force: true });
    } catch (err) {
      console.error("[PhotoshootDashboard] enqueue error", err);
      setError(err.message || String(err));
    }
  }

  if (loading) return <div className="p-6">Loading photoshoot…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!photoshoot) return <div className="p-6">Photoshoot not found.</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold">{photoshoot.name}</h2>
          <div className="text-sm text-gray-500">{photoshoot.description}</div>
          <div className="text-xs text-gray-400 mt-1">Status: {photoshoot.status}</div>
        </div>

        <div className="flex gap-2">
          <button onClick={enqueueJob} className="px-3 py-1 border rounded bg-blue-600 text-white">
            Run Photoshoot
          </button>
          <button onClick={() => fetchData({ force: true })} className="px-3 py-1 border rounded">
            Refresh
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Jobs</h3>
        {jobs.length === 0 ? (
          <div className="text-sm text-gray-500">No jobs yet</div>
        ) : (
          <div className="space-y-2">
            {jobs.map(j => (
              <div key={j.id} className="p-2 border rounded bg-white">
                <div className="flex justify-between">
                  <div>
                    <div className="text-sm font-medium">Job {j.id}</div>
                    <div className="text-xs text-gray-500">Status: {j.status} — Created: {new Date(j.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-xs text-gray-500">{j.result ? "Result present" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Gallery</h3>
        {assets.length === 0 ? (
          <div className="text-sm text-gray-500">No images yet — run a photoshoot</div>
        ) : (
          // ModelViewer expects id prop but the component you showed earlier is ModelViewer expecting an id of collection.
          // We'll directly render the grid here (you can instead pass assets to a generic viewer)
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {assets.map(a => (
              <div key={a.id} className="bg-white rounded-lg overflow-hidden border">
                {a.url ? (
                  <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img src={a.url} alt={a.meta?.filename || a.id} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="p-4 h-48 flex items-center justify-center">No URL</div>
                )}

                <div className="p-3 flex justify-between items-center">
                  <div className="text-sm">{a.meta?.filename || a.id}</div>
                  <div className="flex gap-2">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 border rounded">
                        Open
                      </a>
                    ) : null}
                    <button onClick={() => {
                      console.log("[PhotoshootDashboard] copy url", a.id, a.url);
                      if (a.url) navigator.clipboard?.writeText(a.url);
                    }} className="text-xs px-2 py-1 border rounded">Copy</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
