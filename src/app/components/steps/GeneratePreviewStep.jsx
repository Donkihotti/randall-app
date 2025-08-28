"use client";
import React, { useEffect, useState } from "react";
import FlowNavButtons from "../buttons/FlowNavButtons";
import LoadingOverlay from "../LoadingOverlay";

/**
 * Props:
 *  - subject (object) : subject JSON returned by /api/subject/:id/status
 *  - subjectId (string)
 *  - showNotification(fn)
 *  - onAccept() - called by parent when user accepts/continues
 *  - onBack() - called by parent to go back
 */
export default function GeneratePreviewStep({
  subject,
  subjectId,
  showNotification = () => {},
  onAccept = () => {},
  onBack = () => {}
}) {
  const [localImages, setLocalImages] = useState([]);
  const [editPrompt, setEditPrompt] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    // Pick preview-like assets from subject (face/body previews or generated_face)
    const images = (subject?.assets || [])
      .filter(a => a.url && (
        a.type === "preview" ||
        a.type === "sheet_face" ||
        a.type === "sheet_body" ||
        a.type === "generated_face_replicate" ||
        a.type === "generated_face"
      ))
      .map((a, idx) => ({ url: a.url, id: a.url + "-" + idx, meta: a.meta || {} }));
    setLocalImages(images);
  }, [subject]);

  // Accept: just call parent — do NOT call server approve here.
  function handleAccept() {
    showNotification("Accepted — proceeding", "info");
    onAccept();
  }

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
        body: JSON.stringify(body)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "generate-face failed");

      // Prefer `j.images` (saved public urls), else fallback to subject returned
      const newSaved = (j.images || []).map(i => (typeof i === "string" ? { url: i } : i));

      if (newSaved.length) {
        // put newest images in front
        setLocalImages(prev => [...newSaved.map(s => ({ url: s.url || s, id: s.url || s })), ...prev]);
        showNotification("Edit generated — preview updated", "info");
        setEditPrompt("");
      } else if (j.subject?.assets) {
        const assets = j.subject.assets.filter(a => a.url).map(a => ({ url: a.url, id: a.url }));
        setLocalImages(assets);
        showNotification("Edit generated — preview updated", "info");
        setEditPrompt("");
      } else {
        showNotification("Edit completed but no images were returned", "error");
      }
    } catch (err) {
      console.error("Edit error", err);
      showNotification("Edit failed: " + (err.message || err), "error");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full relative">
      <LoadingOverlay visible={isWorking} message="Working — please wait..." />
      <h2 className="text-xl font-semibold mb-3">Preview generated references</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          {localImages.length === 0 ? (
            <div className="p-8 border rounded text-gray-500">No previews yet — wait for generation or try regenerate.</div>
          ) : (
            <div className="grid gap-3">
              {localImages.map((img, i) => (
                <div key={img.id ?? i} className="rounded overflow-hidden border bg-white">
                  <img src={img.url} alt={`preview-${i}`} className="w-full h-[420px] object-cover" />
                  <div className="p-2 text-xs text-gray-600">Preview {i + 1}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="p-3 border rounded space-y-4">
          <div>
            <strong className="block mb-1">Reference</strong>
            <div className="text-xs text-gray-500 mb-2">Reference images used for generation</div>
            <div className="flex gap-2 flex-wrap">
              {(subject?.faceRefs || []).concat(subject?.bodyRefs || []).map((r, idx) => (
                <div key={idx} className="w-20 h-20 overflow-hidden rounded border">
                  <img src={r.url} alt={`ref-${idx}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <strong className="block mb-1">Edit / refine</strong>
            <textarea
              rows={4}
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="Describe the edit (e.g. soften lighting, add subtle smile)"
              className="w-full p-2 border rounded text-sm"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleApplyEdit} disabled={isWorking || !editPrompt.trim()} className="px-3 py-1 bg-blue-600 text-white rounded">
                Apply Edit (update preview)
              </button>
            </div>
          </div>

          <div>
            <strong className="block mb-1">Actions</strong>
            <FlowNavButtons
              onBack={() => onBack()}
              onContinue={() => handleAccept()}
              backDisabled={isWorking === true}
              continueDisabled={isWorking || localImages.length === 0}
              continueLabel="Accept & Continue"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
