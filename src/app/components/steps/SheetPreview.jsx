"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getSubjectStatus } from "../../../../lib/apiClient";

/**
 * SheetPreview
 * Props:
 *  - subjectId (optional)      // if provided, component will fetch subject status and assets
 *  - images (optional)         // array of assets: { id/assetId, url, signedUrl, object_path, meta, created_at, type }
 *  - filterTypes (optional)    // array of asset.type values to include; default includes sheet_face/sheet_body/generated_face
 *  - initialSelectedId (opt)   // asset id to show initially
 *  - onSelect(asset)           // called when user chooses an image (e.g. accept)
 *  - onClose()                 // optional close handler if used within a modal/dialog
 *  - className                 // optional wrapper class
 */
export default function SheetPreview({
  subjectId = null,
  images = null,
  filterTypes = ["sheet_face", "sheet_body", "generated_face", "preview", "sheet"],
  initialSelectedId = null,
  onSelect = null,
  onClose = null,
  className = "",
}) {
  const [fetchedImages, setFetchedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [main, setMain] = useState(null); // currently displayed large image
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Helper: normalize asset -> image object
  const normalize = (a) => {
    if (!a) return null;
    const id = a.id || a.assetId || a.asset_id || a._id || null;
    const url = a.signedUrl || a.url || (typeof a.object_path === "string" ? a.object_path : null);
    const created = a.created_at || a.createdAt || a.generated_at || a.updated_at || null;
    return { id, url, meta: a.meta || {}, type: a.type || null, raw: a, created };
  };

  // Fetch when subjectId provided AND images not provided
  useEffect(() => {
    let mounted = true;
    if (!subjectId || images) return; // no fetch needed
    setLoading(true);
    (async () => {
      try {
        const res = await getSubjectStatus(subjectId);
        if (!mounted) return;
        const subj = res?.subject || null;
        const assets = Array.isArray(subj?.assets) ? subj.assets : [];
        // normalize + filter types
        const norm = assets
          .map(normalize)
          .filter((i) => i && filterTypes.includes(i.type));
        // sort newest-first by created (fallback alphabetic)
        norm.sort((a, b) => {
          const ta = a.created ? new Date(a.created).getTime() : 0;
          const tb = b.created ? new Date(b.created).getTime() : 0;
          return tb - ta;
        });
        setFetchedImages(norm);
        setLoading(false);
      } catch (err) {
        console.error("SheetPreview fetch error:", err);
        setFetchedImages([]);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [subjectId, images, filterTypes]);

  // source images: prefer prop images if provided
  const srcImages = useMemo(() => {
    const arr = Array.isArray(images) ? images : fetchedImages;
    const norm = (arr || []).map(normalize).filter(Boolean);
    // sort newest-first
    norm.sort((a, b) => {
      const ta = a.created ? new Date(a.created).getTime() : 0;
      const tb = b.created ? new Date(b.created).getTime() : 0;
      return tb - ta;
    });
    return norm;
  }, [images, fetchedImages]);

  // set initial main image
  useEffect(() => {
    if (!srcImages || srcImages.length === 0) {
      setMain(null);
      return;
    }
    // find initialSelectedId or pick first (newest)
    const picked = initialSelectedId ? srcImages.find((s) => s.id === initialSelectedId) : srcImages[0];
    setMain(picked || srcImages[0]);
  }, [srcImages, initialSelectedId]);

  function pickUrl(img) {
    if (!img) return null;
    // if object_path seems to be a relative path (no http) we keep as-is (caller may handle)
    if (!img.url) return null;
    return img.url;
  }

  function handleThumbnailClick(img) {
    setMain(img);
  }

  function handleMainClick() {
    if (main) setLightboxOpen(true);
  }

  function handleChoose() {
    if (onSelect && main) {
      onSelect(main.raw || main);
    }
  }

  return (
    <div className={`sheet-preview-root ${className}`}>
      <div className="bg-white rounded shadow p-4">
        <div className="flex items-start gap-4">
          {/* Left: big preview */}
          <div className="flex-1">
            {loading ? (
              <div className="w-full h-96 flex items-center justify-center text-gray-500">
                Loading previews…
              </div>
            ) : (!main || !pickUrl(main)) ? (
              <div className="w-full h-96 flex items-center justify-center border rounded text-gray-500">
                No sheet images yet.
              </div>
            ) : (
              <div className="relative">
                <img
                  src={pickUrl(main)}
                  alt={`sheet-main-${main.id || "main"}`}
                  className="w-full max-h-[640px] object-cover rounded cursor-zoom-in"
                  onClick={handleMainClick}
                />
                {/* small metadata / age */}
                {main?.meta && (
                  <div className="absolute top-2 left-2 bg-white/90 px-2 py-1 text-xs rounded">
                    {main.meta.version ? `v${main.meta.version}` : (main.meta.generated_by || "")}
                  </div>
                )}
                {/* optional previous-image thumbnail in top-right (if present) */}
                {srcImages.length > 1 && (
                  <div className="absolute top-2 right-2 border bg-white/90 p-1 rounded w-24 h-24 overflow-hidden">
                    {/* second newest */}
                    <img
                      src={pickUrl(srcImages[1])}
                      alt="previous-preview"
                      className="w-full h-full object-cover rounded"
                      onClick={() => handleThumbnailClick(srcImages[1])}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: thumbnails + controls */}
          <div className="w-56 flex flex-col gap-3">
            <div className="text-sm font-medium">All previews</div>
            <div className="flex-1 overflow-auto space-y-2 pr-1">
              {srcImages.length === 0 && !loading && (
                <div className="text-xs text-gray-500">No previews found.</div>
              )}
              {srcImages.map((img) => (
                <button
                  key={img.id || img.url}
                  onClick={() => handleThumbnailClick(img)}
                  className={`w-full flex items-center gap-2 p-1 rounded transition ${main && img.id === main.id ? 'ring-2 ring-default-orange' : 'hover:bg-gray-50'}`}
                >
                  <div className="w-16 h-16 bg-gray-100 overflow-hidden rounded">
                    <img src={pickUrl(img)} alt={`thumb-${img.id}`} className="w-full h-full object-cover" />
                  </div>
                  <div className="text-left text-xs">
                    <div className="font-medium truncate" style={{maxWidth: '160px'}}>{img.meta?.prompt ? img.meta.prompt.slice(0,40) : (img.type || 'preview')}</div>
                    <div className="text-gray-500 text-[11px]">{img.created ? new Date(img.created).toLocaleString() : ''}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleChoose}
                disabled={!main}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
              >
                Choose this
              </button>
              {onClose && (
                <button onClick={onClose} className="px-3 py-2 border rounded">Close</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && main && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="max-w-4xl max-h-full overflow-auto">
            <img src={pickUrl(main)} alt={`lightbox-${main.id}`} className="max-w-full max-h-[90vh] object-contain rounded" />
            <div className="mt-2 text-white text-sm">{main.meta?.prompt || ''}</div>
          </div>
        </div>
      )}
    </div>
  );
}
