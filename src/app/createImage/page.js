'use client'

import React, { useState } from "react";
import { GraphProvider, useGraph } from "./components/GraphContext";
import AddMenu from "./components/AddMenu";
import StageCanvas from "./components/StageCanvas";
import Inspector from "./components/Inspector";
import SideMenu from "./components/SideMenu";

function InnerApp() {
  const { components, links } = useGraph();
  const [assembledPrompt, setAssembledPrompt] = useState("");
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);

  async function assembleGraphPrompt() {
    // Build graph object from context (we have components & links)
    const payload = { graph: { components, links } };
    const res = await fetch("/api/assemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data?.prompt) setAssembledPrompt(data.prompt);
    else setAssembledPrompt("Failed to assemble prompt");
  }

  async function generateFromGraph() {
    setLoading(true);
    setImages([]);
    // assemble first
    const payload = { graph: { components, links } };
    const assembleRes = await fetch("/api/assemble", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const assembleData = await assembleRes.json();
    const prompt = assembleData?.prompt;
    if (!prompt) {
      alert("Failed to assemble prompt");
      setLoading(false);
      return;
    }

    // Send assembled prompt to /api/generate
    const genRes = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: "gpt-image-1",
        size: "1024x1024",
        n: 1
      })
    });
    const genData = await genRes.json();
    if (genData?.images) setImages(genData.images);
    else if (genData?.error) alert("Generate error: " + genData.error);
    else alert("Unknown generation result");
    setLoading(false);
  }

  return (
    <div className="text-black mt-12 gap-4 flex flex-row">
    <SideMenu />

    <div className="flex-1">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Stage</h2>

        <div>
          <button
            onClick={assembleGraphPrompt}
            className="px-3 py-1 rounded-md border mr-0 hover:bg-gray-100"
          >
            Preview Prompt
          </button>
          <button
            onClick={generateFromGraph}
            className="ml-2 px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700"
          >
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>

      <div className="mt-3">
        <StageCanvas />
      </div>

      <div className="mt-3">
        <AddMenu />
      </div>

      <div className="mt-5">
        <h4 className="text-sm font-medium mb-2">Assembled Prompt</h4>
        <pre
          className="bg-neutral-200 border w-2/3 p-3 whitespace-pre-wrap break-words rounded"
        >
          {assembledPrompt}
        </pre>
      </div>

      <div className="mt-3">
        <h4 className="text-sm font-medium mb-2">Generated</h4>
        <div className="flex gap-2.5 flex-wrap">
          {images.map((img, i) => (
            <img
              key={i}
              src={img.url}
              width={240}
              className="w-[240px] h-auto rounded"
              alt={`gen-${i}`}
            />
          ))}
        </div>
      </div>
    </div>

    <div className="w-[360px] flex-shrink-0">
      <h3 className="text-lg font-semibold mb-2">Inspector</h3>
      <Inspector />
      <div className="mt-5">
        <h4 className="text-sm font-medium mb-2">Graph JSON (debug)</h4>
        <pre className="max-h-[300px] overflow-auto bg-[#fff8f0] p-2 rounded">
          {JSON.stringify({ components, links }, null, 2)}
        </pre>
      </div>
    </div>
  </div>
);
}

export default function CreateImage () {
return (
  <GraphProvider>
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Prompt Component Canvas (MVP)</h1>
      <InnerApp />
    </div>
  </GraphProvider>
);
}