// src/app/api/assemble/route.js
import { NextResponse } from "next/server";
import { graphToPrompt } from "../../../../lib/graphToPrompt";

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body || !body.graph) return NextResponse.json({ error: "Missing graph in body" }, { status: 400 });

    const prompt = graphToPrompt(body.graph);
    return NextResponse.json({ prompt }, { status: 200 });
  } catch (err) {
    console.error("Assemble error:", err);
    return NextResponse.json({ error: err.message || "server error" }, { status: 500 });
  }
}
