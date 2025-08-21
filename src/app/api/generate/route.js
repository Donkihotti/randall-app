// src/app/api/generate/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { graphToPrompt } from "../../../../lib/graphToPrompt";
import { assemblePrompt } from "@/app/lib/promptAssembler"; 

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("🔔 /api/generate payload:", Object.keys(body || {}).join(", "));

    // Flexible input handling:
    // priority: body.prompt -> body.graph -> body.subject (structured) -> error
    let prompt = body?.prompt ?? null;
    if (!prompt && body?.graph) {
      try {
        prompt = graphToPrompt(body.graph);
      } catch (e) {
        console.error("graphToPrompt error:", e);
        return NextResponse.json({ error: "Failed to assemble prompt from graph" }, { status: 400 });
      }
    }
    if (!prompt && body?.subject) {
      try {
        prompt = assemblePrompt(body);
      } catch (e) {
        console.error("assemblePrompt error:", e);
        return NextResponse.json({ error: "Failed to assemble prompt from structured JSON" }, { status: 400 });
      }
    }

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt, graph, or subject in request body" }, { status: 400 });
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) {
      console.error("OPENAI_API_KEY not set");
      return NextResponse.json({ error: "Server misconfiguration: OPENAI_API_KEY not set" }, { status: 500 });
    }

    // moderation (best-effort)
    try {
      const modResp = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({ input: [prompt] }),
      });
      const modText = await modResp.text();
      let modJson = null;
      try { modJson = JSON.parse(modText); } catch (e) { /* ignore non-json */ }
      if (modJson?.results?.[0]?.flagged) {
        return NextResponse.json({ error: "Prompt flagged by moderation." }, { status: 400 });
      }
    } catch (mErr) {
      console.warn("Moderation failed (continuing):", mErr?.message || mErr);
    }

    // preview override
    const isPreview = body?.preview === true;
    const previewSize = "256x256";
    const requestedSize = body?.size ?? (body?.resolution ? `${body.resolution.w}x${body.resolution.h}` : "1024x1024");
    const size = isPreview ? previewSize : requestedSize;

    // model & count
    const model = body?.model ?? "gpt-image-1";
    const n = Number(body?.n ?? (body?.instructions?.variations ?? 1));

    // call OpenAI Images generation endpoint
    const openaiResp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        n,
      }),
    });

    const respText = await openaiResp.text();
    let openaiData = null;
    try {
      openaiData = JSON.parse(respText);
    } catch (err) {
      console.error("OpenAI returned non-JSON:", openaiResp.status, respText.slice(0, 1000));
      return NextResponse.json({
        error: "OpenAI returned non-JSON response. Check server logs.",
        status: openaiResp.status,
        bodySnippet: respText.slice(0, 1000),
      }, { status: 500 });
    }

    if (!openaiData?.data || !Array.isArray(openaiData.data)) {
      console.error("OpenAI response missing data:", openaiData);
      return NextResponse.json({ error: "Image generation failed", details: openaiData }, { status: 500 });
    }

    // Save images locally (dev)
    const images = [];
    for (let i = 0; i < openaiData.data.length; i++) {
      const item = openaiData.data[i];
      let buffer;
      if (item.b64_json) {
        buffer = Buffer.from(item.b64_json, "base64");
      } else if (item.url) {
        const r = await fetch(item.url);
        const arr = new Uint8Array(await r.arrayBuffer());
        buffer = Buffer.from(arr);
      } else {
        continue;
      }

      const fname = `gen-${Date.now()}-${i}.png`;
      const outPath = path.join(GENERATED_DIR, fname);
      fs.writeFileSync(outPath, buffer);
      images.push({ url: `/generated/${fname}`, path: outPath });
    }

    // Save metadata for reproducibility
    try {
      fs.writeFileSync(path.join(GENERATED_DIR, `meta-${Date.now()}.json`), JSON.stringify({
        prompt, body, createdAt: new Date().toISOString(), images
      }, null, 2));
    } catch (e) {
      console.warn("Failed writing metadata:", e?.message || e);
    }

    return NextResponse.json({ images, prompt, preview: isPreview }, { status: 200 });
  } catch (err) {
    console.error("API /api/generate error:", err);
    return NextResponse.json({ error: err.message || "server error" }, { status: 500 });
  }
}
