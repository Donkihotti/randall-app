// src/app/api/debug/run-photoshoot-worker/route.js
import { NextResponse } from "next/server";
import { processOneJob } from "../../../../../worker/photoshoot-worker.js";

export async function POST(request) {
  try {
    // token guard for dev: set DEBUG_WORKER_SECRET in env and pass X-DEBUG-WORKER header
    const secret = process.env.DEBUG_WORKER_SECRET || null;
    if (secret) {
      const header = request.headers.get("x-debug-worker") || "";
      if (header !== secret) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    // call worker once
    const ok = await processOneJob();
    return NextResponse.json({ ok: true, processed: !!ok });
  } catch (err) {
    console.error("[debug/run-photoshoot-worker] error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
