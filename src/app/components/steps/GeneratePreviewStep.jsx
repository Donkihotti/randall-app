"use client";
import React, { useEffect, useState } from "react";
import FlowNavButtons from "../buttons/FlowNavButtons";
import LoadingOverlay from "../LoadingOverlay";
import ImageModal from "../ImageModal";

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
  const [openImage, setOpenImage] = useState(null);

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
  async function handleAccept() {
    // When user accepts the preview, generate a full face sheet (nano-banana) and then advance to upscaling step.
    if (!subjectId) {
      showNotification("No subject id", "error");
      return;
    }

    try {
      setIsWorking(true);
      showNotification("Generating face sheet (this may take a minute)...", "info");

      const body = {
        previewOnly: false, // final sheet generation (you can set true if you want preview-only)
        faceAngles: ["center","up-left","up","up-right","left","3q-left","3q-right","right","down"],
        // optionally: settings: { /* replicate params */ }
      };

      const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/generate-model-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "generate-model-sheet failed");

      // server returns subject updated with assets; update local images & notify
      if (j?.subject) {
        // add newly saved images to local display
        const newImages = (j.saved || []).map(s => ({ url: s.url, id: s.url }));
        if (newImages.length) {
          setLocalImages(prev => [...newImages, ...prev]);
        }
        showNotification("Face sheet generated. Moving to Upscale step.", "info");
      } else {
        showNotification("Face sheet generation completed.", "info");
      }

      // call parent's onAccept to advance the flow (CreateModelFlow will setStatus -> upscaling)
      onAccept();
    } catch (err) {
      console.error("generate-sheet error", err);
      showNotification("Generate sheet failed: " + (err.message || err), "error");
    } finally {
      setIsWorking(false);
    }
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
    <div className="p-6 max-w-4xl mx-auto w-full flex flex-col relative gap-y-2">
      <LoadingOverlay visible={isWorking} message="Working — please wait..." />
      <h2 className="text-xl font-semibold mb-3">Preview generated reference</h2>
      <div className="flex flex-col">
        <div className="h-1/2">
          {localImages.length === 0 ? (
            <div className="p-8 border rounded text-gray-500">No previews yet — wait for generation or try regenerate.</div>
          ) : (
            <div className="grid gap-3">
              {localImages.map((img, i) => (
                <div key={img.id ?? i} className="rounded overflow-hidden ">
                  <img src={img.url} alt={`preview-${i}`} className="w-full h-[420px] object-cover" />
                  <div className="p-2 text-xs text-gray-600">Preview {i + 1}</div>
                </div>
              ))}
            </div>
          )}
        </div>

          <div>
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
            <div className="flex gap-2 mt-2">
            </div>
          </div>

          <div>
            <FlowNavButtons
              onBack={() => onBack()}
              onContinue={() => handleAccept()}
              backDisabled={isWorking === true}
              continueDisabled={isWorking || localImages.length === 0}
              continueLabel="Continue"
            />
          </div>
    
      </div>
    </div>
  );
}
