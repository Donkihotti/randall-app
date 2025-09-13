// src/components/GenerateStep.jsx
"use client";

import React, { useState } from "react";
import ButtonOrange from "../buttons/ButtonOrange";
import pickAssetUrl from "../../../../lib/pickAsset";

/**
 * GenerateStep
 * Props:
 *  - subjectId (optional)
 *  - name (optional)
 *  - showNotification(fn)
 *  - onQueued({ jobId, subjectId, images, subject })  // called after generation (job enqueued OR preview ready)
 *  - setStatus(optional)
 */
export default function GenerateStep({ subjectId: propSubjectId, name: propName = "", showNotification, onQueued, setStatus }) {
  const [subjectId, setSubjectId] = useState(propSubjectId || null);
  const [name, setName] = useState(propName || "");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(7.5);
  const [promptStrength, setPromptStrength] = useState(0.45);
  const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);

  const [previewImages, setPreviewImages] = useState([]); // array of { url }

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
    const sid = j.subjectId || (j.subject && j.subject.id) || null;
    setSubjectId(sid);
    return sid;
  }

  async function handleGenerate(e) {
    e?.preventDefault?.();
    if (!name.trim()) {
      showNotification?.("Add a model name", "error");
      return;
    }
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

      // defensive parse
      const contentType = res.headers.get("content-type") || "";
      let j = null;
      if (contentType.includes("application/json")) {
        j = await res.json().catch(() => null);
      } else {
        const txt = await res.text().catch(() => null);
        throw new Error("Unexpected server response: " + (txt ? txt.slice(0, 200) : "no body"));
      }

      if (!res.ok) {
        throw new Error(j?.error || "Generation failed");
      }

      // Normalize response
      const jobId = j?.jobId ?? j?.data?.jobId ?? j?.id ?? null;
      const imagesRaw = Array.isArray(j?.images)
        ? j.images
        : Array.isArray(j?.data?.images)
        ? j.data.images
        : [];
      // Build canonical images array: { assetId, url, meta }
      const images = (imagesRaw || [])
        .map((i) => {
          if (!i) return null;
          // i may be: string (url) OR object { url, objectPath, assetId, meta, id, signedUrl }
          const url = pickAssetUrl(i) || i.url || i.objectPath || i.object_path || null;
          const assetId = i.assetId || i.id || null;
          const meta = i.meta || {};
          return url ? { assetId, url, meta } : null;
        })
       .filter(Boolean);

      // Call parent ONCE with the canonical payload
      onQueued?.({
        jobId: jobId || null,
        subjectId: id,
        images,
        subject: j.subject || null,
        forcePreview: !!body?.previewOnly || true // cause GenerateStep always invoked with previewOnly true in this flow, but pass explicit
      })

      // Show immediate preview locally if images exist
      if (images.length > 0) {
        // images are already { assetId, url, meta }
        setPreviewImages(images.map((i) => ({ url: i.url, assetId: i.assetId, meta: i.meta })));
        showNotification?.('Preview generated', 'info');
        if (setStatus) setStatus('generate-preview');
      } else if (jobId) {
        showNotification?.("Generation queued — waiting for previews", "info");
      } else {
       // No inline images returned. Try to reconcile against persisted assets (server may have persisted images).
        // If the server returned a subject row we can ask the canonical assets endpoint for 'latest' assets.
        if (returnedSubject && returnedSubject.id) {
          try {
            const assetsRes = await fetch(`/api/subject/${encodeURIComponent(returnedSubject.id)}/assets?group=latest`, { credentials: "include" });
            const assetsJson = assetsRes.headers.get("content-type")?.includes("application/json") ? await assetsRes.json().catch(()=>null) : null;
            const persisted = Array.isArray(assetsJson?.assets) ? assetsJson.assets : [];
            if (persisted.length > 0) {
              const mapped = persisted.map(a => ({ url: a.signedUrl || a.url, assetId: a.id, meta: a.meta || {} })).filter(p => !!p.url);
              if (mapped.length > 0) {
                // call parent and show immediate preview locally
                onQueued?.({
                  jobId: jobId || null,
                  subjectId: id,
                  images: mapped,
                  subject: returnedSubject || null,
                  forcePreview: !!body?.previewOnly || true
                });
                setPreviewImages(mapped.map(m=>({ url: m.url })));
                showNotification?.("Preview (from persisted assets) generated", "info");
                if (setStatus) setStatus("generate-preview");
                return;
              }
            }
          } catch (e) {
            console.warn("generate-face: failed to fetch persisted assets", e);
          }
        }

        showNotification?.("No preview or job returned from server", "error");
        console.warn("generate-face: unexpected response", j);
      }
    } catch (err) {
      console.error("GenerateStep generate error", err);
      showNotification?.("Generation failed: " + (err.message || err), "error");
    } finally {
      setIsGeneratingLocal(false);
    }
  }

  function handleRegenerate() {
    setPreviewImages([]);
    showNotification?.("Ready to regenerate", "info");
  }

  return (
    <div className="p-6 max-w-3xl mx-auto w-full">
      <div className="mt-6">
        {previewImages.length === 0 ? <div className="text-gray-500"></div> : (
          <div>
            <div className="flex gap-3 items-start">
              {previewImages.map((p, i) => (
                <img key={i} src={p.url} alt={`preview-${i}`} className="w-96 h-96 object-cover rounded shadow" />
              ))}
            </div>

            <div className="flex gap-3 mt-3">
              <button onClick={handleRegenerate} className="px-4 py-2 border rounded">Regenerate</button>
            </div>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold mb-3">Generate face reference for {name || "Unnamed model"}</h2>

      <form onSubmit={handleGenerate} className="space-y-2">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
          className="textarea-default w-full p-2 bg-normal rounded-md  border border-light" placeholder="Photorealistic female model, neutral expression..." />

        <div className="flex flex-row justify-end gap-3">
        <button type="button" onClick={() => setStatus?.("choose")} className="px-3.5 bg-normal rounded-xs hover:cursor-pointer">
            Back
          </button>
          <ButtonOrange type="submit" disabled={isGeneratingLocal}>
            {isGeneratingLocal ? "Generating…" : "Create"}
          </ButtonOrange>
        </div>
      </form>
    </div>
  );
}
