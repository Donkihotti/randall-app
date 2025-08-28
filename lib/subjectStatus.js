// src/lib/subjectStatus.js
/**
 * subjectStatus.js
 *
 * Utilities for mapping server-side subject.status -> local flow step.
 * Centralizing this logic avoids duplicated mapping across components.
 *
 * Exports:
 *  - mapServerStatus(subject) -> string | null
 *      Returns the local flow key to use (e.g. "generate", "generating-sheet",
 *      "generate-preview", "validating", "ready", "failed") or null if mapping
 *      should not change client state.
 *
 *  - hasPreviewAssets(subject) -> boolean
 */

function _normalize(s) {
    return String(s || "").toLowerCase();
  }
  
  export function hasPreviewAssets(subject) {
    if (!subject || !Array.isArray(subject.assets)) return false;
    return subject.assets.some((a) =>
      ["preview", "sheet_face", "sheet_body", "generated_face_replicate", "generated_face"].includes(a.type)
    );
  }
  
  /**
   * mapServerStatus(subject)
   *
   * Rules:
   *  - if subject is draft/awaiting prompt -> "generate" (open prompt editor)
   *  - queued/preprocessing -> "validating" (uploads being processed)
   *  - generating/queued_generation/running -> "generating-sheet"
   *  - awaiting-approval/sheet_generated/preview_ready -> "generate-preview" (only if preview assets exist)
   *  - generated/ready -> "ready"
   *  - failed/error -> "failed"
   *  - if server status already is a known flow key, return it
   *  - otherwise return null (do not stomp client state)
   *
   * Returning `null` means: keep current client view — used to avoid flash/auto-navigation
   * when the server status is ambiguous or transient.
   */
  export function mapServerStatus(subject) {
    if (!subject) return null;
    const s = _normalize(subject.status);
  
    // Draft / user should create prompt -> open generate editor
    if (s === "awaiting-generation" || s === "draft" || s === "awaiting_prompt") return "generate";
  
    // queued / preprocessing -> validating
    if (s === "queued" || s === "preprocess" || s === "preprocessing" || s === "queued_preprocess") {
      return "validating";
    }
  
    // worker is generating (or queued for generation)
    if (s.includes("generat") || s === "running" || s === "processing" || s === "generating" || s.includes("queued_generation")) {
      return "generating-sheet";
    }
  
    // previews ready / awaiting approval -> preview step, but only if there are preview assets
    if (["awaiting-approval", "sheet_generated", "preview_ready"].includes(s)) {
      if (hasPreviewAssets(subject)) return "generate-preview";
      // no preview assets yet -> show generating-sheet so user sees progress
      return "generating-sheet";
    }
  
    // final images generated / ready to use -> ready/finalize
    if (s === "generated" || s === "ready") return "ready";
  
    // failure
    if (s === "failed" || s === "error") return "failed";
  
    // if server status already matches known flow key, return it (backwards compatibility)
    const KNOWN = new Set([
      "choose",
      "generate",
      "uploading",
      "validating",
      "generating-sheet",
      "generate-preview",
      "sheet-preview",
      "upscaling",
      "finalize",
      "ready",
      "failed",
    ]);
    if (KNOWN.has(s)) return s;
  
    // Unknown / transient -> return null (do not change client)
    return null;
  }
  