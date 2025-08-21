// src/components/PreviewAndGenerateControls.jsx
"use client";

import React, { useState } from "react";
import UploadAsset from "./UploadAsset";
import { useGraph } from "./GraphContext";

/*
  Usage:
    <PreviewAndGenerateControls />
  or
    <PreviewAndGenerateControls components={components} links={links} />
  It will use GraphContext if props are not provided.
*/

function estimateCost(sizeStr, n = 1) {
  if (sizeStr === "256x256") return 0.003 * n;
  if (sizeStr === "1024x1024") return 0.10 * n;
  if (sizeStr === "2048x2048") return 0.35 * n;
  return 0.12 * n;
}

export default function PreviewAndGenerateControls({ components: propsComponents, links: propsLinks }) {
  // prefer props, otherwise use GraphContext
  const graphCtx = useGraph ? useGraph() : null;
  const components = propsComponents ?? graphCtx?.components ?? [];
  const links = propsLinks ?? graphCtx?.links ?? [];

  const [previewImages, setPreviewImages] = useState([]);
  const [finalImages, setFinalImages] = useState([]);
  const [previewPrompt, setPreviewPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastCost, setLastCost] = useState(null);
  const [lastError, setLastError] = useState(null);

  async function assemblePromptFromGraph() {
    const res = await fetch("/api/assemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: { components, links } }),
    });
    const data = await res.json();
    return data?.prompt;
  }

  async function generatePreview() {
    setIsLoading(true);
    setLastError(null);
    try {
      const prompt = await assemblePromptFromGraph();
      setPreviewPrompt(prompt || "");
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, preview: true, size: "256x256", n: 1 }),
      });
      const data = await res.json();
      if (data?.images) {
        setPreviewImages(data.images);
      } else {
        setPreviewImages([]);
        setLastError(data?.error || "Preview generation failed");
        console.warn("Preview error payload:", data);
      }
      // compute & show an estimated cost for final
      setLastCost(estimateCost("1024x1024", 1));
    } catch (e) {
      console.error("preview error", e);
      setLastError(String(e));
      alert("Preview failed — check console");
    } finally {
      setIsLoading(false);
    }
  }

  async function finalizeGenerate({ size = "1024x1024", n = 1 } = {}) {
    setIsLoading(true);
    setLastError(null);
    try {
      const prompt = previewPrompt || (await assemblePromptFromGraph());
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, preview: false, size, n }),
      });
      const data = await res.json();
      if (data?.images) {
        setFinalImages(data.images);
        // optionally show a success toast instead of alert
        alert("Final generation complete — images saved to public/generated (dev)");
      } else {
        setLastError(data?.error || "Generation failed");
        console.warn("Generate error payload:", data);
        alert("Generation error: " + (data?.error || "unknown"));
      }
    } catch (e) {
      console.error("finalize error", e);
      setLastError(String(e));
      alert("Finalize failed — check console");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUploadedUrl(url) {
    // Simple helpful behavior:
    // - put the uploaded URL into the clipboard so the user can paste into the component inspector
    try {
      await navigator.clipboard.writeText(url);
      alert("Uploaded. URL copied to clipboard — paste into your component inspector: " + url);
    } catch {
      alert("Uploaded: " + url + "\n(also copied to clipboard if allowed)");
    }
  }

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#ffffff" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={generatePreview} disabled={isLoading}>
          {isLoading ? "Working…" : "Preview (cheap)"}
        </button>

        <button onClick={() => finalizeGenerate({ size: "1024x1024", n: 1 })} disabled={isLoading}>
          Finalize (1024)
        </button>

        <button onClick={() => finalizeGenerate({ size: "2048x2048", n: 1 })} disabled={isLoading}>
          Finalize (2048)
        </button>

        <div style={{ marginLeft: "auto", fontSize: 13, color: "#555" }}>
          Estimated final cost:{" "}
          {lastCost !== null ? <strong>${lastCost.toFixed(3)}</strong> : "— generate preview to estimate"}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <UploadAsset onUploaded={handleUploadedUrl} />
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: "8px 0" }}>Preview prompt</h4>
        <pre style={{ background: "#f6f6f6", padding: 8, minHeight: 64, whiteSpace: "pre-wrap" }}>
          {previewPrompt || "—"}
        </pre>
      </div>

      {lastError && (
        <div style={{ color: "crimson", marginTop: 8 }}>
          <strong>Error:</strong> {lastError}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <h4 style={{ margin: "8px 0" }}>Preview images</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {previewImages.length ? (
            previewImages.map((img, i) => (
              <img key={i} src={img.url} width={160} alt={`preview-${i}`} style={{ borderRadius: 6 }} />
            ))
          ) : (
            <div style={{ color: "#777" }}>No preview yet</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <h4 style={{ margin: "8px 0" }}>Final images</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {finalImages.length ? (
            finalImages.map((img, i) => (
              <img key={i} src={img.url} width={240} alt={`final-${i}`} style={{ borderRadius: 6 }} />
            ))
          ) : (
            <div style={{ color: "#777" }}>No final images yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
