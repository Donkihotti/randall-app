// src/app/createModel/generate/page.jsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function GenerateModelPage() {
  const search = useSearchParams();
  const router = useRouter();
  const subjectIdParam = search?.get("subjectId");
  const nameParam = search?.get("name") || "";

  const [subjectId, setSubjectId] = useState(subjectIdParam || null);
  const [name, setName] = useState(nameParam || "");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(7.5);
  const [promptStrength, setPromptStrength] = useState(0.45);
  const [isQueueing, setIsQueueing] = useState(false);

  useEffect(() => {
    if (nameParam) setName(nameParam);
  }, [nameParam]);

  async function createDraftSubjectIfNeeded() {
    if (subjectId) return subjectId;
    const payload = { name: name || "Unnamed model", basePrompt: prompt || "", draft: true };
    const res = await fetch("/api/subject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error || "Failed to create draft subject");
    setSubjectId(j.subjectId);
    return j.subjectId;
  }

  async function handleQueueGenerate(e) {
    e?.preventDefault?.();
    if (!name?.trim()) return alert("Add a model name.");
    setIsQueueing(true);
    try {
      const id = await createDraftSubjectIfNeeded();

      // assemble payload for generate-model-sheet: include basePrompt + extra prompt override
      const body = {
        previewOnly: true,
        settings: {
          steps,
          guidance_scale: guidance,
          prompt_strength: promptStrength
        },
        // we pass basePrompt in subject already; additionally include prompt override in payload (worker can use)
        promptOverride: prompt || undefined
      };

      const res = await fetch(`/api/subject/${encodeURIComponent(id)}/generate-model-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "enqueue failed");

      alert("Generation job queued. SubjectId: " + id);
      // optionally navigate to the CreateModelFlow page to show progress:
      router.push(`/createModel?subjectId=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("queue error", err);
      alert("Failed to enqueue generation: " + (err.message || err));
    } finally {
      setIsQueueing(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Generate model from scratch</h1>

      <form onSubmit={handleQueueGenerate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Model name</label>
          <input value={name} onChange={(e)=>setName(e.target.value)} className="w-full p-2 border rounded" placeholder="My model" />
        </div>

        <div>
          <label className="block text-sm font-medium">Prompt (describe the model)</label>
          <textarea value={prompt} onChange={(e)=>setPrompt(e.target.value)} rows={4} className="w-full p-2 border rounded" placeholder="e.g. photorealistic male model, neutral expression, short hair..." />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm">Steps</label>
            <input type="number" value={steps} onChange={(e)=>setSteps(Number(e.target.value))} className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm">Guidance</label>
            <input type="number" value={guidance} onChange={(e)=>setGuidance(Number(e.target.value))} step="0.1" className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm">Prompt strength</label>
            <input type="number" value={promptStrength} onChange={(e)=>setPromptStrength(Number(e.target.value))} step="0.01" className="w-full p-2 border rounded" />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={isQueueing} className="px-4 py-2 bg-blue-600 text-white rounded">
            {isQueueing ? "Queueing…" : "Queue generation"}
          </button>
          <button type="button" onClick={()=>router.push("/createModel")} className="px-4 py-2 border rounded">Back</button>
        </div>
      </form>
    </div>
  );
}
