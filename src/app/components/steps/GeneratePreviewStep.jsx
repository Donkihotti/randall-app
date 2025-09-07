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
  const [localImages, setLocalImages] = useState(Array.isArray(initialPreview) ? initialPreview : []);
  const [editPrompt, setEditPrompt] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [openImage, setOpenImage] = useState(null);

  // Helper: normalize assets to { url, id, meta }
  function assetsToImages(assets = []) {
    return (assets || [])
      .filter(Boolean)
      .map((a, idx) => {
        const url = a.signedUrl || a.url || a.object_url || a.objectPath || a.object_path || null;
        return { url, id: (url ? url : `asset-${idx}-${Date.now()}`), meta: a.meta || a };
      })
      .filter((x) => !!x.url);
  }

  // If initialPreview exists, prefer it; else pick from subject.assets
  useEffect(() => {
    if (initialPreview && Array.isArray(initialPreview) && initialPreview.length > 0) {
      const imgs = initialPreview.map((i, idx) => ({ url: i.url || i, id: (i.id || `${i.url || idx}-${Date.now()}`), meta: i.meta || {} }));
      setLocalImages(imgs);
      return;
    }

    // use subject.assets snapshot if present
    const imgs = assetsToImages(subject?.assets || []);
    setLocalImages(imgs);
  }, [subject, initialPreview]);

  // If we have no images but subjectId exists, try to fetch fresh subject status once (worker might have just persisted)
  useEffect(() => {
    if ((localImages && localImages.length > 0) || !subjectId) return;
    let mounted = true;
    (async () => {
      try {
        console.log("[GeneratePreviewStep] no initialPreview, fetching fresh subject status to pick up any new assets");
        const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/status`, {
          method: "GET",
          credentials: "include",
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) {
          console.warn("[GeneratePreviewStep] /status fetch failed:", j);
          return;
        }
        if (!mounted) return;
        const assets = assetsToImages(j?.subject?.assets || []);
        if (assets && assets.length > 0) {
          setLocalImages(assets);
        }
      } catch (err) {
        console.error("[GeneratePreviewStep] fetch fresh subject status error:", err);
      }
    })();
    return () => { mounted = false; };
  }, [subjectId, localImages]);

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

    const refUrl = localImages[0].url; // default reference

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
        const txt = await res.text().catch(() => null);
        throw new Error("Unexpected server response: " + (txt ? txt.slice(0, 300) : "no body"));
      }

      if (!res.ok) {
        throw new Error(j?.error || "Edit generation failed");
      }

      // Prefer immediate images in response (j.images), else fallback to subject assets
      const returnedImages = Array.isArray(j?.images)
        ? j.images.map((i) => (typeof i === "string" ? { url: i } : i))
        : Array.isArray(j?.data?.images)
        ? j.data.images.map((i) => (typeof i === "string" ? { url: i } : i))
        : [];

      if (returnedImages.length > 0) {
        const mapped = returnedImages
          .map((s, idx) => ({ url: s.url || s, id: s.url || `returned-${idx}-${Date.now()}` }))
          .filter((x) => !!x.url);
        setLocalImages((prev) => [...mapped, ...(prev || [])]);
        showNotification("Edit generated — preview updated", "info");
        setEditPrompt("");
        return;
      }

      // fallback: server returned a subject with assets
      if (j?.subject?.assets && Array.isArray(j.subject.assets)) {
        const assets = assetsToImages(j.subject.assets);
        if (assets.length > 0) {
          setLocalImages((prev) => [...assets, ...(prev || [])]);
          showNotification("Edit generated — preview updated", "info");
          setEditPrompt("");
          return;
        }
      }

      // if server returned jobId (async), just notify and parent will poll
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
