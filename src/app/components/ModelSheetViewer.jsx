// src/components/ModelSheetViewer.jsx
"use client";

import { useEffect, useState, useRef } from "react";

/**
 * ModelSheetViewer
 * Default export (client component)
 */
export default function ModelSheetViewer({ subjectId, pollInterval = 2000 }) {
  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!subjectId) return;
    fetchAndUpdate();
    startPolling();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  async function fetchAndUpdate() {
    if (!subjectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/subject/${subjectId}/status`);
      if (!res.ok) {
        console.warn("Failed to fetch subject status", await res.text());
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSubject(data.subject || null);
    } catch (err) {
      console.error("fetch status err", err);
    } finally {
      setLoading(false);
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(fetchAndUpdate, pollInterval);
  }
  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleApprove() {
    if (!subjectId) return;
    if (!confirm("Approve this subject and mark Ready?")) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/subject/${subjectId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "approve failed");
      setSubject(data.subject || subject);
      alert("Subject approved.");
    } catch (err) {
      console.error("approve error", err);
      alert("Approve failed: " + (err.message || err));
    } finally {
      setApproving(false);
    }
  }

  if (!subjectId) return <div className="p-3 text-sm text-gray-500">No subject selected</div>;

  const bodyAssets = (subject?.assets || []).filter(a => a.type === "sheet_body");
  const faceAssets = (subject?.assets || []).filter(a => a.type === "sheet_face");
  const previewAssets = (subject?.assets || []).filter(a => a.type === "preview");

  return (
    <div className="p-3 bg-white rounded-md">
      <div className="flex items-center justify-between mb-3">
        <div>
          <strong>Subject:</strong> {subject?.name || subjectId}{" "}
          <span className="text-xs text-gray-500">({subject?.status || "unknown"})</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAndUpdate} className="px-3 py-1 bg-gray-200 rounded">Refresh</button>
          <button onClick={handleApprove} disabled={approving || !subject} className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50">
            {approving ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="font-medium">Body sheet</h4>
        {bodyAssets.length === 0 ? (
          <div className="text-sm text-gray-500">No body sheet images yet</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            {bodyAssets.map((a, i) => (
              <div key={i} className="border rounded overflow-hidden">
                <img src={a.url} alt={`body-${i}`} className="w-full h-40 object-cover" />
                <div className="p-2 text-xs flex justify-between items-center">
                  <div>{a.view || "view"}</div>
                  <div className="flex gap-1">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600">Open</a>
                    <a href={a.url} download className="text-blue-600">Download</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4">
        <h4 className="font-medium">Face sheet</h4>
        {faceAssets.length === 0 ? (
          <div className="text-sm text-gray-500">No face sheet images yet</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-2">
            {faceAssets.map((a, i) => (
              <div key={i} className="border rounded overflow-hidden">
                <img src={a.url} alt={`face-${i}`} className="w-full h-28 object-cover" />
                <div className="p-2 text-xs flex justify-between items-center">
                  <div>{a.angle || a.meta?.angle || "angle"}</div>
                  <div className="flex gap-1">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600">Open</a>
                    <a href={a.url} download className="text-blue-600">Download</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="font-medium">Previews / other</h4>
        {previewAssets.length === 0 ? (
          <div className="text-sm text-gray-500">No preview images</div>
        ) : (
          <div className="flex gap-3 mt-2">
            {previewAssets.map((a, i) => (
              <div key={i} className="w-[160px] border rounded overflow-hidden">
                <img src={a.url} alt={`prev-${i}`} className="w-full h-28 object-cover" />
                <div className="p-2 text-xs flex justify-between">
                  <div>{a.view || ""}</div>
                  <a href={a.url} download className="text-blue-600">Download</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
