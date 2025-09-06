// src/components/GeneratePreviewStep.jsx
"use client";

import React, { useEffect, useState } from "react";
import FlowNavButtons from "../buttons/FlowNavButtons";
import LoadingOverlay from "../LoadingOverlay";
import ImageModal from "../ImageModal";

/**
 * Props:
 *  - subject (object) : subject JSON returned by /api/subject/:id/status
 *  - subjectId (string)
 *  - initialPreview (optional) : [{ url }] immediate preview images (optional)
 *  - showNotification(fn)
 *  - onAccept() - called by parent when user accepts/continues
 *  - onBack() - called by parent to go back
 */
export default function GeneratePreviewStep({
  subject,
  subjectId,
  initialPreview = [],
  showNotification = () => {},
  onAccept = () => {},
  onBack = () => {}
}) {
  // localImages: array of { url, id, meta }
  const [localImages, setLocalImages] = useState(Array.isArray(initialPreview) ? normalizeInitial(initialPreview) : []);
  const [editPrompt, setEditPrompt] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [openImage, setOpenImage] = useState(null);

  // Helper: normalize initialPreview (strings or objects) into {url, id, meta}
  function normalizeInitial(arr = []) {
    return (arr || [])
      .filter(Boolean)
      .map((i, idx) => {
        const url = typeof i === "string" ? i : i.url || i.signedUrl || null;
        const meta = typeof i === "object" ? (i.meta || {}) : {};
        const id = i.id || (url ? `preview-${url}` : `preview-${idx}-${Date.now()}`);
        return { url, id, meta };
      })
      .filter((x) => !!x.url);
  }

  // Helper: normalize assets to { url, id, meta }
  function assetsToImages(assets = []) {
    return (assets || [])
      .filter(Boolean)
      .map((a, idx) => {
        // prefer signedUrl, then url, then objectPath-ish
        const url = a.signedUrl || a.url || a.object_url || a.objectPath || a.object_path || null;
        const meta = a.meta || {};
        const id = url ? `asset-${url}` : `asset-${idx}-${Date.now()}`;
        return { url, id, meta };
      })
      .filter((x) => !!x.url);
  }

  // Merge helper that dedupes by url (keeps earlier items first)
  function mergeDedup(primary = [], secondary = []) {
    const seen = new Set();
    const out = [];
    for (const p of primary || []) {
      if (!p || !p.url) continue;
      if (!seen.has(p.url)) {
        out.push(p);
        seen.add(p.url);
      }
    }
    for (const s of secondary || []) {
      if (!s || !s.url) continue;
      if (!seen.has(s.url)) {
        out.push(s);
        seen.add(s.url);
      }
    }
    return out;
  }

  useEffect(() => {
    try {
      const init = normalizeInitial(initialPreview || []);
      const fromSubject = assetsToImages(subject?.assets || []);

      // prefer initial preview first (optimistic), then server assets; dedupe by URL
      const merged = mergeDedup(init, fromSubject);

      // If there were no initial previews, but server has assets, show server assets
      const final = merged.length > 0 ? merged : fromSubject;

      setLocalImages(final);
    } catch (e) {
      console.warn("GeneratePreviewStep: failed to build images from subject/initialPreview", e);
      // fallback: leave localImages unchanged
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, initialPreview]);

  // Accept: call parent (parent will change flow state)
  function handleAccept() {
    showNotification("Accepted — proceeding", "info");
    onAccept();
  }

  // Apply an edit to the first preview image
  async function handleApplyEdit() {
    if (!editPrompt.trim()) {
      showNotification("Add an edit prompt", "error");
      return;
    }
    if (!localImages || localImages.length === 0) {
      showNotification("No preview image available to edit", "error");
      return;
    }

    const refUrl = localImages[0].url; // use the first image as reference
    setIsWorking(true);
    showNotification("Applying edit — please wait", "info");

    try {
      const body = { prompt: editPrompt, image_input: [refUrl], previewOnly: true };
      const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/generate-face`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      const contentType = res.headers.get("content-type") || "";
      let j = null;
      if (contentType.includes("application/json")) {
        j = await res.json().catch(() => null);
      } else {
        // fallback: read text for debugging
        const txt = await res.text().catch(() => null);
        throw new Error("Unexpected server response: " + (txt ? txt.slice(0, 300) : "no body"));
      }

      if (!res.ok) {
        throw new Error(j?.error || "Edit generation failed");
      }

      // 1) Prefer immediate images in response (j.images / j.data.images)
      const returnedImages =
        Array.isArray(j?.images) ? j.images :
        Array.isArray(j?.data?.images) ? j.data.images :
        [];

      if (returnedImages.length > 0) {
        const mapped = (returnedImages || []).map((s, idx) => {
          if (typeof s === "string") return { url: s, id: `returned-${s}`, meta: {} };
          const url = s.url || s.signedUrl || s.object_url || s.objectPath || s.object_path || null;
          return { url, id: s.id || (url ? `returned-${url}` : `returned-${idx}-${Date.now()}`), meta: s.meta || {} };
        }).filter(x => !!x.url);

        // merge into localImages (newest first), dedupe
        const merged = mergeDedup(mapped, localImages);
        setLocalImages(merged);
        showNotification("Edit generated — preview updated", "info");
        setEditPrompt("");
        return;
      }

      // 2) Fallback: server returned a subject with assets
      if (j?.subject?.assets && Array.isArray(j.subject.assets)) {
        const serverAssets = assetsToImages(j.subject.assets);
        if (serverAssets.length > 0) {
          const merged = mergeDedup(serverAssets, localImages);
          setLocalImages(merged);
          showNotification("Edit generated — preview updated", "info");
          setEditPrompt("");
          return;
        }
      }

      // 3) If server returned jobId (async), notify user and let poll pick up later
      if (j?.jobId || j?.data?.jobId || j?.id) {
        showNotification("Edit queued for processing — waiting for preview", "info");
        return;
      }

      showNotification("Edit completed but no images were returned", "error");
    } catch (err) {
      console.error("Edit error", err);
      showNotification("Edit failed: " + (err.message || err), "error");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full flex flex-col relative gap-y-4">
      <LoadingOverlay visible={isWorking} message="Working — please wait..." />
      <h2 className="text-xl font-semibold mb-3">Preview generated reference</h2>

      <div>
        {localImages.length === 0 ? (
          <div className="p-8 border rounded text-gray-500">No previews yet — wait for generation or try regenerate.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {localImages.map((img, i) => (
              <div key={img.id || `${i}-${Date.now()}`} className="rounded overflow-hidden border">
                <img
                  src={img.url}
                  alt={`preview-${i}`}
                  className="w-full h-[420px] object-cover cursor-pointer"
                  onClick={() => setOpenImage(img.url)}
                />
                <div className="p-2 text-xs text-gray-600">Preview {i + 1}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="relative w-full">
          <textarea
            rows={4}
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="Describe the edit (e.g. soften lighting, add subtle smile)"
            className="textarea-default bg-normal w-full p-2 border rounded text-sm"
          />

          <button
            onClick={handleApplyEdit}
            disabled={isWorking || !editPrompt.trim()}
            className="absolute bottom-3.5 right-2 px-3 py-1 bg-white text-black rounded-xs disabled:opacity-50 hover:cursor-pointer"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="mt-4">
        <FlowNavButtons
          onBack={() => onBack()}
          onContinue={() => handleAccept()}
          backDisabled={isWorking === true}
          continueDisabled={isWorking || localImages.length === 0}
          continueLabel="Continue"
        />
      </div>

      {openImage && (
        <ImageModal src={openImage} onClose={() => setOpenImage(null)} />
      )}
    </div>
  );
}
