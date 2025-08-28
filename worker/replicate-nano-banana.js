// worker/replicate-nano-banana.js
import fs from "fs";
import path from "path";
import Replicate from "replicate";

const OUT_DIR = path.join(process.cwd(), "public", "generated");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN || "" });

export async function runNanoBanana(input) {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN not set in env");
  }
  if (!input || (!input.prompt && !input.image_input)) {
    throw new Error("Provide at least a prompt or image_input");
  }

  try {
    // Use REPLICATE_MODEL_NAME or default to google/nano-banana
    const modelId = process.env.REPLICATE_MODEL_NAME || "google/nano-banana";

    // run returns (depending on model) string, array, or object
    const output = await replicate.run(modelId, { input });

    // normalize to urls
    let urls = [];
    if (!output) throw new Error("Replicate returned empty output");
    if (typeof output === "string") urls = [output];
    else if (Array.isArray(output)) urls = output.map((x) => (typeof x === "string" ? x : x?.url)).filter(Boolean);
    else if (output.url) urls = [output.url];
    else if (Array.isArray(output.output)) urls = output.output.map((x) => (typeof x === "string" ? x : x?.url)).filter(Boolean);
    else {
      // fallback find urls inside response
      try {
        const s = JSON.stringify(output);
        const found = s.match(/https?:\/\/[^\s"']+/g);
        if (found) urls = Array.from(new Set(found));
      } catch (e) {}
    }

    if (!urls.length) throw new Error("No URLs in replicate output: " + JSON.stringify(output).slice(0, 500));

    const saved = [];
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      const r = await fetch(u);
      if (!r.ok) {
        console.warn("Failed to download replicate url:", u, r.status);
        continue;
      }
      const arr = new Uint8Array(await r.arrayBuffer());
      const buf = Buffer.from(arr);
      const fname = `replicate-nano-${Date.now()}-${i}.png`;
      const outPath = path.join(OUT_DIR, fname);
      fs.writeFileSync(outPath, buf);
      saved.push({ url: `/generated/${fname}`, path: outPath });
    }

    return { ok: true, saved, raw: output };
  } catch (err) {
    console.error("runNanoBanana error:", err);
    return { ok: false, error: String(err), raw: err?.response || null };
  }
}
