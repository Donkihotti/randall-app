// src/app/api/generate/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assemblePrompt } from "@/app/lib/promptAssembler";

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

export async function POST(request) {
  try {
    const json = await request.json();
    if (!json || !json.subject) {
      return NextResponse.json({ error: "Missing subject in JSON" }, { status: 400 });
    }

    const prompt = assemblePrompt(json);

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) {
      console.error("OPENAI_API_KEY missing");
      return NextResponse.json({ error: "Server misconfiguration: OPENAI_API_KEY not set" }, { status: 500 });
    }

    // Moderation (optional) - keep it, but handle errors gracefully
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
      try { modJson = JSON.parse(modText); } catch (e) {
        console.warn("Moderation non-JSON response:", modResp.status, modText.slice(0, 500));
      }
      if (modJson?.results?.[0]?.flagged) {
        return NextResponse.json({ error: "Prompt flagged by moderation." }, { status: 400 });
      }
    } catch (mErr) {
      console.warn("Moderation call failed:", mErr.message);
      // proceed — moderation is useful but should not always block dev flow
    }

    // Call OpenAI Images endpoint
    const size =
      json.resolution && json.resolution.w && json.resolution.h
        ? `${json.resolution.w}x${json.resolution.h}`
        : "1024x1024";

    const openaiResp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: json.model || "gpt-image-1",
        prompt,
        size,
        n: json.instructions?.variations || 1,
      }),
    });

    // If response not ok, capture text for diagnostics
    const respText = await openaiResp.text();
    let openaiData = null;
    try {
      openaiData = JSON.parse(respText);
    } catch (err) {
      console.error("OpenAI returned non-JSON. Status:", openaiResp.status, "Body (first 1000 chars):", respText.slice(0,1000));
      return NextResponse.json({
        error: "OpenAI returned non-JSON response. See server logs for details.",
        status: openaiResp.status,
        bodySnippet: respText.slice(0,1000)
      }, { status: 500 });
    }

    if (!openaiData?.data) {
      console.error("OpenAI JSON missing data:", openaiData);
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

    // Save metadata (optional)
    fs.writeFileSync(path.join(GENERATED_DIR, `meta-${Date.now()}.json`), JSON.stringify({
      prompt, json, createdAt: new Date().toISOString(), images
    }, null, 2));

    return NextResponse.json({ images, prompt }, { status: 200 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: err.message || "server error" }, { status: 500 });
  }
}
