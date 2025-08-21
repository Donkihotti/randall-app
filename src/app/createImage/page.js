'use client'

import React, { useState } from "react";
import { GraphProvider, useGraph } from "./components/GraphContext";
import StageCanvas from "./components/StageCanvas";
import Inspector from "./components/Inspector";
import SideMenu from "./components/SideMenu";
import PreviewAndGenerateControls from "./components/PreviewAndGenerateControls";

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
    <div className="text-black flex flex-col md:flex-row">
      <div className="w-full md:w-52 flex-shrink-0">
        <SideMenu />
      </div>

      <div className="flex-1 h-screen">
        <div className="h-full">
          <StageCanvas />
          <PreviewAndGenerateControls />
        </div>
        <div className="mt-3 absolute bottom-0">
          <h4 className="text-sm font-medium mb-2">Generated</h4>
          <div className="flex gap-2.5 flex-wrap">
            {images.map((img, i) => (
              <img
                key={i}
                src={img.url}
                className="w-[240px] h-auto rounded"
                alt={`gen-${i}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="w-full md:w-[360px] flex-shrink-0 md:mt-0 border border-neutral-500 absolute right-5 top-5 p-5">
        <h3 className="text-lg font-semibold mb-2 text-white">Inspector</h3>
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

export default function CreateImage() {
  return (
    <GraphProvider>
      <div className="">
        <InnerApp />
      </div>
    </GraphProvider>
  );
}