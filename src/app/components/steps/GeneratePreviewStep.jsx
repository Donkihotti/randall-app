// src/components/GeneratePreviewStep.jsx
"use client";

import React, { useEffect, useState, useRef } from "react";
import FlowNavButtons from "../buttons/FlowNavButtons";
import LoadingOverlay from "../LoadingOverlay";
import ImageModal from "../modals/ImageModal";

import pickAssetUrl from "../../../../lib/pickAsset";

/**
 * Props:
 *  - subject (object) : subject JSON returned by /api/subject/:id/status (may be stale)
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
  const mountedRef = useRef(true);

  // helper: normalize assets rows to { url, assetId, meta, created_at }
  function assetsToImages(assets = []) {
    return (assets || [])
      .filter(Boolean)
      .map((a) => {
        // server returns object_path or objectPath and possibly a stored url (may be a signed url)
        const url = a.signedUrl || a.url || a.object_url || a.objectPath || a.object_path || a.objectpath || null;
        return { url, assetId: a.id || a.assetId || null, meta: a.meta || a, created_at: a.created_at || a.createdAt || null };
      })
      .filter(x => !!x.url)
      // sort newest first (created_at desc)
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
  }

  // When we mount (or when subject updates) and we don't have initialPreview
    useEffect(() => {
      if (Array.isArray(initialPreview) && initialPreview.length > 0) {
        // already provided by parent; prefer it
        setLocalImages(initialPreview);
        return;
    }
  
    if (!subject || !subject.assets || subject.assets.length === 0) {
        // nothing persisted yet
        setLocalImages([]);
        return;
      }
  
      // Map server-side asset rows to client preview images using pickAssetUrl
      const previewAssets = (subject.assets || [])
      .filter((a) =>
          ['preview', 'generated_face', 'generated_face_replicate', 'sheet_face', 'sheet_body'].includes(a.type)
        )
        .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
        .map((a) => ({
          assetId: a.id,
          url: pickAssetUrl(a),
          meta: a.meta || {},
        }))
      .filter((p) => !!p.url);
  
      setLocalImages(previewAssets);
    }, [initialPreview, subject])

  // If initialPreview is provided, prefer it — otherwise attempt to fetch fresh assets from server
  useEffect(() => {
    mountedRef.current = true;
    async function fetchStatusOnce() {
      try {
        if (initialPreview && Array.isArray(initialPreview) && initialPreview.length > 0) {
          const imgs = initialPreview.map((i, idx) => ({ url: i.url || i, assetId: (i.assetId || i.id || `${idx}-${Date.now()}`), meta: i.meta || {} }));
          if (mountedRef.current) setLocalImages(imgs);
          return;
        }

        // If subject.assets present (maybe stale), use them immediately if non-empty
        const initialAssets = assetsToImages(subject?.assets || []);
        if (initialAssets.length > 0) {
          if (mountedRef.current) setLocalImages(initialAssets);
          return;
        }

        // Otherwise poll /api/subject/:id/status a few times to wait for persisted assets
        const maxAttempts = 10;
        let attempt = 0;
        while (mountedRef.current && attempt < maxAttempts) {
          attempt++;
          const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/assets`, { credentials: "include" });
          if (!res.ok) {
            console.warn("[GeneratePreviewStep] /assets fetch failed", res.status, await res.text().catch(()=>null));
          } else {
            const j = await res.json().catch(() => null);
            const rows = j?.assets || [];
            if (rows.length > 0) {
              const assets = assetsToImages(rows); // your helper to normalize a => {url, assetId, meta}
              if (assets.length > 0) {
                if (mountedRef.current) {
                  setLocalImages(assets);
                  showNotification("Preview available", "info");
                }
                return;
              }
            }
          }
          // wait a bit then try again
          await new Promise(r => setTimeout(r, 1500));
        }

        // timed out — leave localImages as-is (empty or previous)
        if (mountedRef.current && (!localImages || localImages.length === 0)) {
          showNotification("Still waiting for preview — try again or check generate logs", "info");
        }
      } catch (err) {
        console.error("[GeneratePreviewStep] status fetch error", err);
      }
    }

    fetchStatusOnce();
    return () => { mountedRef.current = false; };
  }, [initialPreview, subjectId, subject]);

  // Accept: call parent (parent will change flow state)
  function handleAccept() {
    showNotification("Accepted — proceeding", "info");
    onAccept();
  }

  // Apply an edit to the first preview image (same semantics you had)
  async function handleApplyEdit() {
    if (!editPrompt.trim()) {
      showNotification("Add an edit prompt", "error");
      return;
    }
    if (!localImages || localImages.length === 0) {
      showNotification("No preview image available to edit", "error");
      return;
    }

    const refUrl = localImages[0].url;
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
        // If server returned safety info, bubble it up
        throw new Error(j?.error || "Edit generation failed");
      }

      // Prefer immediate images in response (j.images)
      const returnedImages = Array.isArray(j?.images) ? j.images.map(i => (typeof i === "string" ? { url: i } : i)) : [];
      if (returnedImages.length > 0) {
        const mapped = returnedImages.map((s, idx) => ({ url: s.url || s, assetId: s.assetId || s.id || `returned-${idx}-${Date.now()}`, meta: s.meta || {} })).filter(x => !!x.url);
        if (mapped.length > 0) {
          setLocalImages(prev => [...mapped, ...(prev || [])]);
          showNotification("Edit generated — preview updated", "info");
          setEditPrompt("");
          setIsWorking(false);
          return;
        }
      }

      // fallback: server returned new subject.assets
      if (j?.subject?.assets && Array.isArray(j.subject.assets)) {
        const assets = assetsToImages(j.subject.assets);
        if (assets.length > 0) {
          setLocalImages(prev => [...assets, ...(prev || [])]);
          showNotification("Edit generated — preview updated", "info");
          setEditPrompt("");
          setIsWorking(false);
          return;
        }
      }

      // job queued case
      if (j?.jobId || j?.data?.jobId || j?.id) {
        showNotification("Edit queued for processing — waiting for preview (server will persist asset)", "info");
        setIsWorking(false);
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

  // Find a parent asset for the newest image (if meta.parent_id or meta.parentAssetId)
  function findParentFor(image, assetsList) {
    if (!image || !assetsList || assetsList.length === 0) return null;
    // meta might contain parent_id or parentAssetId or parent_asset_id
    const parentId = image.meta?.parent_id || image.meta?.parentAssetId || image.meta?.parentAssetId || image.meta?.parentId || image.meta?.parent || null;
    if (parentId) {
      return assetsList.find(a => (a.assetId === parentId || a.assetId === String(parentId) || a.assetId === a.assetId && a.assetId === parentId));
    }
    // attempt to match based on meta.parent_asset_url or meta.parent_url
    const pUrl = image.meta?.parent_asset_url || image.meta?.parent_url || null;
    if (pUrl) {
      return assetsList.find(a => a.url === pUrl);
    }
    return null;
  }

  // Render: show newest big image and optional parent overlay top-right
  const newest = localImages && localImages.length > 0 ? localImages[0] : null;
  const parent = newest ? findParentFor(newest, localImages.concat((subject?.assets || []).map(a => ({ url: a.signedUrl || a.url || a.object_url || a.object_path, assetId: a.id, meta: a.meta })))) : null;

  return (
    <div className="p-6 max-w-4xl mx-auto w-full flex flex-col relative gap-y-4">
      <LoadingOverlay visible={isWorking} message="Working — please wait..." />
      <h2 className="text-xl font-semibold mb-3">Preview generated reference</h2>

      <div>
        {(!newest) ? (
          <div className="p-8 border rounded text-gray-500">No previews yet — wait for generation or try regenerate.</div>
        ) : (
          <div className="border rounded overflow-hidden">
            {/* Main big image */}
            <img
              src={newest.url}
              alt="new-preview"
              className="w-full h-[520px] object-cover cursor-pointer"
              onClick={() => setOpenImage(newest.url)}
            />
            <div className="p-2 text-xs text-gray-600">Newest preview</div>

            {/* Parent (old) small overlay */}
            {parent && parent.url && (
              <div
                className="absolute top-3 right-3 bg-white/90 p-1 rounded shadow cursor-pointer"
                onClick={() => setOpenImage(parent.url)}
                title="Previous version"
                style={{ width: 120, height: 120 }}
              >
                <img src={parent.url} alt="previous" className="w-full h-full object-cover rounded" />
              </div>
            )}
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

      <div className="mt-4 flex flex-row justify-end">
        <FlowNavButtons
          onBack={() => onBack()}
          onContinue={() => handleAccept()}
          backDisabled={isWorking === true}
          continueDisabled={isWorking || !newest}
          continueLabel="Continue"
        />
      </div>

      {openImage && <ImageModal src={openImage} onClose={() => setOpenImage(null)} />}
    </div>
  );
}
