// src/components/GenerateStep.jsx
"use client";

import React, { useState } from "react";
import ButtonOrange from "../buttons/ButtonOrange";

/**
 * GenerateStep
 * Props:
 *  - subjectId (optional)
 *  - name (optional)
 *  - showNotification(fn)
 *  - onQueued({ jobId, subjectId })  // called after generation (job enqueued OR preview ready)
 *  - setStatus(optional)
 */
export default function GenerateStep({ subjectId: propSubjectId, name: propName = "", showNotification, onQueued, setStatus }) {
  const [subjectId, setSubjectId] = useState(propSubjectId || null);
  const [name, setName] = useState(propName || "");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(7.5);
  const [promptStrength, setPromptStrength] = useState(0.45);
  const [isGenerating, setIsGenerating] = useState(false);

  const [previewImages, setPreviewImages] = useState([]); // array of { url }
  const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);

  async function createDraftIfNeeded() {
    if (subjectId) return subjectId;
    const payload = { name: name || "Unnamed model", draft: true };
    const res = await fetch("/api/subject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error || "Failed to create draft subject");
    setSubjectId(j.subjectId || (j.subject && j.subject.id) || null);
    return j.subjectId || (j.subject && j.subject.id) || null;
  }

  async function handleGenerate(e) {
    e?.preventDefault?.();
    if (!name.trim()) {
      showNotification?.("Add a model name", "error");
      return;
    }
    setIsGenerating(true);
    setIsGeneratingLocal(true);
    try {
      const id = await createDraftIfNeeded();
      if (!id) throw new Error("Could not create subject");

      // build request body
      const body = {
        previewOnly: true,
        prompt: prompt || undefined,
        settings: {
          steps,
          guidance_scale: guidance,
          prompt_strength: promptStrength,
        },
      };

      const res = await fetch(`/api/subject/${encodeURIComponent(id)}/generate-face`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      // defensive: if not ok and response body is html, capture text
      const contentType = res.headers.get("content-type") || "";
      let j = null;
      if (contentType.includes("application/json")) {
        j = await res.json().catch(() => null);
      } else {
        // non-json -> read text for debug
        const txt = await res.text().catch(() => null);
        throw new Error("Unexpected server response: " + (txt ? txt.slice(0, 200) : "no body"));
      }

      if (!res.ok) {
        throw new Error(j?.error || "Generation failed");
      }

      // server may either return immediate images OR a jobId (async)
      // handle both cases
      const jobId = j?.jobId ?? j?.data?.jobId ?? j?.id ?? null;
      const images = (j.images || []).map(i => (typeof i === 'string' ? { url: i } : i));
      onQueued?.({ jobId: j.jobId || null, subjectId: id, images, subject: j.subject || null });  

      if (Array.isArray(images) && images.length > 0) {
        const mapped = images.map((i) => ({ url: i.url || i }));
        setPreviewImages(mapped);
        showNotification?.("Preview generated", "info");
      
        // inform parent and advance to preview step (no manual Accept)
        // <-- PASS IMAGES to parent so it can show them and prevent poll override
        onQueued?.({ jobId: jobId || null, subjectId: id, images: mapped });
        if (setStatus) setStatus("generate-preview");
      } else if (jobId) {
        onQueued?.({ jobId, subjectId: id });
        showNotification?.("Generation queued — waiting for previews", "info");
      } else {
        showNotification?.("No preview or job returned from server", "error");
        console.warn("generate-face: unexpected response", j);
      }

    } catch (err) {
      console.error("GenerateStep generate error", err);
      showNotification?.("Generation failed: " + (err.message || err), "error");
    } finally {
      setIsGenerating(false);
      setIsGeneratingLocal(false);
    }
  }

  function handleRegenerate() {
    // clear preview and let user generate again
    setPreviewImages([]);
    showNotification?.("Ready to regenerate", "info");
  }

  return (
    <div className="p-6 max-w-3xl mx-auto w-full">
      <div className="mt-6">
        {previewImages.length === 0 ? (
          <div className="text-gray-500"></div>
        ) : (
          <div>
            <div className="flex gap-3 items-start">
              {previewImages.map((p, i) => (
                <img key={i} src={p.url} alt={`preview-${i}`} className="w-96 h-96 object-cover rounded shadow" />
              ))}
            </div>

            <div className="flex gap-3 mt-3">
              <button onClick={handleRegenerate} className="px-4 py-2 border rounded">
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold mb-3">Generate face reference for {name || "Unnamed model"}</h2>

      <form onSubmit={handleGenerate} className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="textarea-default w-full p-2 bg-normal rounded-md"
          placeholder="Photorealistic female model, neutral expression..."
        />

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs">Steps</label>
            <input type="number" value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full p-1 border rounded" />
          </div>
          <div>
            <label className="block text-xs">Guidance</label>
            <input type="number" value={guidance} step="0.1" onChange={(e) => setGuidance(Number(e.target.value))} className="w-full p-1 border rounded" />
          </div>
          <div>
            <label className="block text-xs">Prompt strength</label>
            <input type="number" value={promptStrength} step="0.01" onChange={(e) => setPromptStrength(Number(e.target.value))} className="w-full p-1 border rounded" />
          </div>
        </div>

        <div className="flex gap-3">
          <ButtonOrange type="submit" disabled={isGeneratingLocal}>
            {isGeneratingLocal ? "Generating…" : "Create"}
          </ButtonOrange>

          <button type="button" onClick={() => setStatus?.("choose")} className="px-2 bg-normal rounded-xs">
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
