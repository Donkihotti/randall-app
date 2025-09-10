"use client";

import React, { useEffect, useMemo, useState } from "react";

/**
 * SheetPreview
 * Props:
 *  - subjectId (optional)      // if provided, component will fetch subject status and assets unless parent `subject` is provided
 *  - subject (optional)        // canonical subject object provided by parent - prefer this
 *  - images (optional)         // array of assets: { id/assetId, url, signedUrl, object_path, meta, created_at, type }
 *  - filterTypes (optional)    // array of asset.type values to include; default includes sheet_face/sheet_body/generated_face
 *  - initialSelectedId (opt)   // asset id to show initially
 *  - onSelect(asset)           // called when user chooses an image (e.g. accept)
 *  - onClose()                 // optional close handler if used within a modal/dialog
 *  - className                 // optional wrapper class
 */
export default function SheetPreview({
  subjectId = null,
  subject = null,
  images = null,
  filterTypes = null, // will be memoized below to avoid identity changes
  initialSelectedId = null,
  onSelect = null,
  onClose = null,
  className = "",
}) {
  const [fetchedImages, setFetchedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [main, setMain] = useState(null); // currently displayed large image
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // stable default for filter types — memoized so identity doesn't change each render
  const effectiveFilterTypes = useMemo(() => {
    return Array.isArray(filterTypes) && filterTypes.length
      ? filterTypes
      : ["sheet_face", "sheet_body", "generated_face", "preview", "sheet"];
    // only recalculates if the incoming filterTypes reference actually changes
  }, [filterTypes]);

  // Helper: normalize asset -> image object
  const normalize = (a) => {
    if (!a) return null;
    const id = a.id || a.assetId || a.asset_id || a._id || null;
    const url = a.signedUrl || a.url || (typeof a.object_path === "string" ? a.object_path : null);
    const created = a.created_at || a.createdAt || a.generated_at || a.updated_at || null;
    return { id, url, meta: a.meta || {}, type: a.type || null, raw: a, created };
  };

  // Primary effect: prefer parent-provided subject (no fetch),
  // else use provided images prop, else fallback to a one-time fetch.
  useEffect(() => {
    let mounted = true;

    // If parent gave canonical subject, prefer it and do not fetch.
    if (subject) {
      const assets = Array.isArray(subject.assets) ? subject.assets : [];
      console.log("[SheetPreview] using parent-provided subject; subjectId=", subject?.id, "assets_len=", assets.length);
      const norm = assets
        .map(normalize)
        .filter((i) => i && effectiveFilterTypes.includes(i.type));

      norm.sort((a, b) => {
        const ta = a.created ? new Date(a.created).getTime() : 0;
        const tb = b.created ? new Date(b.created).getTime() : 0;
        return tb - ta;
      });

      if (mounted) {
        setFetchedImages(norm);
        setLoading(false);
      }
      return () => { mounted = false; };
    }

    // If explicit images prop provided, use that directly (no fetch).
    if (images) {
      console.log("[SheetPreview] using images prop; images_len=", images.length);
      const norm = images.map(normalize).filter(Boolean);
      norm.sort((a, b) => {
        const ta = a.created ? new Date(a.created).getTime() : 0;
        const tb = b.created ? new Date(b.created).getTime() : 0;
        return tb - ta;
      });
      if (mounted) {
        setFetchedImages(norm);
        setLoading(false);
      }
      return () => { mounted = false; };
    }

    // Fallback: one-time fetch if we have subjectId but no parent subject or images.
    if (!subjectId) {
      if (mounted) {
        setFetchedImages([]);
        setLoading(false);
      }
      return () => { mounted = false; };
    }

    setLoading(true);
    (async () => {
      try {
        console.log("[SheetPreview] fetching subject status once for subjectId=", subjectId);
        const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/status`, { credentials: 'include' });
        if (!mounted) return;
        const j = await res.json().catch(() => null);
        const subj = j?.subject || null;
        const assets = Array.isArray(subj?.assets) ? subj.assets : [];
        console.log("[SheetPreview] fetched subject assets_len=", assets.length);
        const norm = assets
          .map(normalize)
          .filter((i) => i && effectiveFilterTypes.includes(i.type));

        norm.sort((a, b) => {
          const ta = a.created ? new Date(a.created).getTime() : 0;
          const tb = b.created ? new Date(b.created).getTime() : 0;
          return tb - ta;
        });

        if (mounted) setFetchedImages(norm);
      } catch (err) {
        console.error("[SheetPreview] fetch error:", err);
        if (mounted) setFetchedImages([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [subjectId, images, subject, effectiveFilterTypes]);

  // source images: prefer prop images if provided
  const srcImages = useMemo(() => {
    const arr = Array.isArray(images) ? images : fetchedImages;
    const norm = (arr || []).map(normalize).filter(Boolean);
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
    const picked = initialSelectedId ? srcImages.find((s) => s.id === initialSelectedId) : srcImages[0];
    setMain(picked || srcImages[0]);
  }, [srcImages, initialSelectedId]);

  function pickUrl(img) {
    if (!img) return null;
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
      <div className="bg-normal border border-light rounded-md shadow p-4">
        <div className="flex items-start gap-6">
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
                  className="w-full max-h-[640px] object-cover rounded-xs cursor-zoom-in"
                  onClick={handleMainClick}
                />
                {main?.meta && (
                  <div className="absolute top-2 left-2 bg-white/90 px-2 py-1 text-xs rounded">
                    {main.meta.version ? `v${main.meta.version}` : (main.meta.generated_by || "")}
                  </div>
                )}
                {srcImages.length > 1 && (
                  <div className="absolute top-2 right-2 border bg-white/90 p-1 rounded w-24 h-24 overflow-hidden">
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
            <div className="flex-1 overflow-auto space-y-2 px-3.5">
              {srcImages.length === 0 && !loading && (
                <div className="text-xs text-gray-500">No previews found.</div>
              )}
              {srcImages.map((img) => (
                <button
                  key={img.id || img.url}
                  onClick={() => handleThumbnailClick(img)}
                  className={`w-full flex items-center gap-4 p-1 rounded transition ${main && img.id === main.id ? 'bg-lighter' : 'hover:bg-lighter hover:cursor-pointer'}`}
                >
                  <div className="w-36 h-36 bg-red-100 overflow-hidden rounded">
                    <img src={pickUrl(img)} alt={`thumb-${img.id}`} className="w-full h-full object-cover" />
                  </div>
                </button>
              ))}
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
          
          </div>
        </div>
      )}
    </div>
  );
}
