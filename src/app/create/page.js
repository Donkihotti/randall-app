'use client';

import { useEffect, useState } from "react";
import ButtonDefault from "../components/ButtonDefault";
import SelectField from "./components/SelectField";

const CAMERA_PRESETS = [
  { id: "studio-portrait", label: "Studio Portrait", focal: 85, aspect: "4:5" },
  { id: "hero-wide", label: "Hero Wide", focal: 35, aspect: "16:9" },
  { id: "full-body", label: "Full Body", focal: 50, aspect: "3:4" },
  { id: "top-down", label: "Top Down", focal: 24, aspect: "1:1" },
];

export default function Home() {
  const [promptText, setPromptText] = useState("");
  const [subjectType, setSubjectType] = useState("person");
  const [shotType, setShotType] = useState("headshot"); 
  const [cameraPreset, setCameraPreset] = useState(CAMERA_PRESETS[0].id);
  const [focal, setFocal] = useState(CAMERA_PRESETS[0].focal);
  const [feel, setFeel] = useState("studio"); 
  const [variations, setVariations] = useState(1);
  const [previewPrompt, setPreviewPrompt] = useState("");
  const [images, setImages] = useState([]);
  const [lighting, setLighting] = useState("Three-Point Lighting Setup (Classic Studio Portrait)")

  const [loading, setLoading] = useState(false);
  const [jsonPreview, setJsonPreview] = useState(null);
  const [error, setError] = useState(null);

  // Build canonical JSON from UI controls
  function buildGenerationJSON() {
    const cameraPresetObj = CAMERA_PRESETS.find(p => p.id === cameraPreset) || {};
    const resolution = cameraPresetObj.aspect === "16:9" ? { w: 2048, h: 1152 } : { w: 1024, h: 1024 };

    const genJson = {
      model: "gpt-image-1",
      resolution,
      seed: null,
      quality_tier: "standard",
      camera: {
        preset: cameraPresetObj.label || "Custom",
        focal_length_mm: focal,
        aspect_ratio: cameraPresetObj.aspect || "1:1",
      },
      lighting: {
        type: lighting,
      },
      subject: {
        type: subjectType, // person / product / scene
        shot: shotType, // headshot / full-body / product-shot
      },
      style: {
        feel,
        style_ref_urls: [],
        negative_prompts: []
      },
      instructions: {
        prompt_text: promptText || null,
        variations: variations
      },
      postprocess: { upscale: "none", color_grade: "auto", format: "png" }
    };
    return genJson;
  }

  // Whenever inputs change, update the JSON preview and ask server to assemble the prompt
  useEffect(() => {
    const json = buildGenerationJSON();
    setJsonPreview(json);
    // Debounce preview calls slightly
    const t = setTimeout(() => previewAssembledPrompt(json), 250);
    return () => clearTimeout(t);
  }, [promptText, subjectType, lighting, shotType, cameraPreset, focal, feel, variations]);

  async function previewAssembledPrompt(json) {
    try {
      setError(null);
      const res = await fetch("/api/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (data?.prompt) setPreviewPrompt(data.prompt);
      else setPreviewPrompt("");
    } catch (err) {
      console.error("Preview error", err);
      setError("Preview failed; see console");
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setImages([]);
    const payload = buildGenerationJSON();
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.images) setImages(data.images);
      else setError(data?.error || "Generation failed");
    } catch (err) {
      console.error("Generate error", err);
      setError("Generation failed, check console");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{  fontFamily: "system-ui, sans-serif" }} className="text-black mt-12 overflow-hidden">
        <div className="w-screen h-[70vh] bg-neutral-600"></div>
      
    <div className="p-5 flex flex-col">
      <section style={{ display: "flex", gap: 20, marginBottom: 12 }}>
      <SelectField
        label="Subject type"
        value={subjectType}
        onChange={e => setSubjectType(e.target.value)}
        options={[
            { value: "person", label: "Person" },
            { value: "product", label: "Product" },
            { value: "scene", label: "Scene" },
        ]}
        >
        </SelectField>

        <div>
          <label>Shot</label><br />
          <select value={shotType} onChange={e => setShotType(e.target.value)}>
            <option value="headshot">Headshot</option>
            <option value="full-body">Full Body</option>
            <option value="product-shot">Product Shot</option>
          </select>
        </div>

        <div>
          <label>Feel</label><br />
          <select value={feel} onChange={e => setFeel(e.target.value)}>
            <option value="studio">Studio</option>
            <option value="iphone">iPhone</option>
            <option value="photoshoot">Photoshoot</option>
          </select>
        </div>
      </section>

      <section>
        <label>Lighting</label>
        <select value={lighting} onChange={e => setLighting(e.target.value)}>
            <option value={"A professional studio portrait of [subject], shot with a three-point lighting setup — key light positioned at 45° with a softbox, fill light reducing shadows on the opposite side, rim light creating subtle separation from the background. Clean, balanced illumination, perfect for corporate headshots or fashion photography."}>
                Three-Point Lighting Setup (Classic Studio Portrait)
            </option>
            <option value={"lit with butterfly lighting — a beauty dish placed high above and centered, casting a soft shadow directly under the nose. Smooth skin highlights, glamorous old Hollywood style, perfect for editorial and fashion photography."}>
                Butterfly Lighting, Hollywood Glamour
            </option>
            <option value={"A candid photo of [subject] taken under an overcast sky — the clouds acting as a giant softbox, even and shadowless lighting, muted color palette, perfect for natural lifestyle portraits or documentary-style photography."}>
                Overcast Sky (Soft Diffused Light)
            </option>
        </select>
      </section>

      <section style={{ marginBottom: 12 }}>
        <label>Camera preset</label><br />
        <select value={cameraPreset} onChange={e => { setCameraPreset(e.target.value); const p = CAMERA_PRESETS.find(x=>x.id===e.target.value); if(p) setFocal(p.focal); }}>
          {CAMERA_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label} ({p.focal}mm)</option>)}
        </select>

        <div style={{ marginTop: 8 }}>
          <label>Focal length: {focal} mm</label><br />
          <input type="range" min="24" max="200" value={focal} onChange={e => setFocal(Number(e.target.value))} />
        </div>

        <div style={{ marginTop: 8 }}>
          <label>Variations: {variations}</label>
          <input style={{ marginLeft: 8 }} type="range" min="1" max="4" value={variations} onChange={e=> setVariations(Number(e.target.value))} />
        </div>
      </section>

      <section style={{ marginBottom: 12 }}>
        <label>Free prompt (optional)</label><br />
        <textarea rows="3" cols="80" value={promptText} onChange={e => setPromptText(e.target.value)} />
      </section>

      <section style={{ marginTop: 8 }}>
        <ButtonDefault onClick={handleGenerate} disabled={loading} text={"generate"}>{loading ? "Generating..." : "Create"}</ButtonDefault>
      </section>

      {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}

      <section style={{ marginTop: 20 }}>
        <h3>Assembled prompt (preview)</h3>
        <div style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 10 }}>{previewPrompt || "—"}</div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h3>Generation JSON</h3>
        <pre style={{ background: "#fff8f0", padding: 10 }}>{JSON.stringify(jsonPreview, null, 2)}</pre>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2>Results</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {images.map((img, idx) => (
            <div key={idx}><img src={img.url} width={256} alt={`gen-${idx}`} /></div>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
