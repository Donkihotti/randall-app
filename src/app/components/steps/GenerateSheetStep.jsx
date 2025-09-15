"use client";
 
 import { useEffect, useState, useRef } from "react";
 import { enqueueModelSheet } from "../../../../lib/apiClient";
 import SheetPreview from "./SheetPreview";
 import ButtonOrange from "../buttons/ButtonOrange";
 import { useRouter } from "next/navigation";
 
 /**
  * GenerateSheetStep
  * - ensures canonical sheet assets are fetched (with retries) and passed to SheetPreview
  * - merges canonical sheet assets into parent subject (via setSubject) and clears lastEnqueueRef via clearLastEnqueue()
  */
 export default function GenerateSheetStep({ subjectId, subject, setStatus, clearLock, setSubject, clearLastEnqueue, showNotification }) {
   const [isGenerating, setIsGenerating] = useState(false);
   const [sheetAssets, setSheetAssets] = useState([]); // canonical sheet assets we fetched
   const mountedRef = useRef(true);
   const [isSaving, setIsSaving] = useState(false);
   const router = useRouter();
 
   // debug log to make it obvious what parent subject contains
   console.log("[GenerateSheetStep] mount subjectId=", subjectId, "subject_assets_len=", Array.isArray(subject?.assets) ? subject.assets.length : 0);
 
   useEffect(() => {
     mountedRef.current = true;
     return () => { mountedRef.current = false; };
   }, []);
 
   // Helper: shallow-equality for arrays of ids (same order)
   function arraysEqual(a = [], b = []) {
     if (a === b) return true;
     if (!Array.isArray(a) || !Array.isArray(b)) return false;
     if (a.length !== b.length) return false;
     for (let i = 0; i < a.length; i++) {
       if (String(a[i]) !== String(b[i])) return false;
     }
     return true;
   }
 
   // Helper to pick URL from an asset row (mirror logic used elsewhere)
   function pickAssetUrl(a) {
     if (!a) return null;
     return a.signedUrl || a.url || a.object_url || a.objectPath || a.object_path || a.objectpath || null;
   }
 
   // Normalize server asset rows into simple objects for SheetPreview
   function normalizeAssets(rows = []) {
     return (rows || [])
       .filter(Boolean)
       .map((a) => ({
         id: a.id || a.assetId || null,
         url: pickAssetUrl(a),
         meta: a.meta || {},
         type: a.type || null,
         created_at: a.created_at || a.createdAt || a.updated_at || null,
         raw: a,
       }))
       .filter(x => !!x.url)
       .sort((a, b) => {
         const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
         const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
         return tb - ta;
       });
   }
 
   // Poll the canonical assets endpoint until we find sheet assets (or run out of attempts).
   // NOTE: short-circuit if we already have canonical assets in this component (sheetAssets).
   useEffect(() => {
     if (!subjectId) return;
     if (sheetAssets.length > 0) {
       console.log("[GenerateSheetStep] canonical sheetAssets already present locally -> skipping polling");
       return;
     }
 
     let aborted = false;
     const maxAttempts = 50;
     const intervalMs = 1500;
 
     async function fetchSheetAssetsOnce() {
       try {
         console.log(`[GenerateSheetStep] fetchSheetAssetsOnce subjectId=${subjectId}`);
         const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/assets?group=sheet`, { credentials: "include", cache: "no-store" });
         if (!res.ok) {
           console.warn("[GenerateSheetStep] canonical assets fetch non-ok", res.status);
           return null;
         }
         const j = await res.json().catch(() => null);
         const rows = Array.isArray(j?.assets) ? j.assets : (Array.isArray(j) ? j : []);
         return rows;
       } catch (err) {
         console.error("[GenerateSheetStep] fetchSheetAssetsOnce error", err);
         return null;
       }
     }
 
     (async () => {
       for (let attempt = 1; attempt <= maxAttempts && !aborted && mountedRef.current; attempt++) {
         console.log(`[GenerateSheetStep] attempting fetch canonical sheet assets (attempt ${attempt}/${maxAttempts})`);
         const rows = await fetchSheetAssetsOnce();
         const normalized = normalizeAssets(rows || []);
         console.log(`[GenerateSheetStep] fetch attempt ${attempt} -> found ${normalized.length} sheet assets`);
         if (aborted || !mountedRef.current) break;
         if (normalized.length > 0) {
           // update local canonical sheet assets (this will be passed to SheetPreview)
           setSheetAssets(normalized);
 
           // MERGE into parent subject so overlay logic in CreateModelFlow picks it up
           try {
             if (typeof setSubject === "function") {
               const normalizedRaw = (rows || []).map(r => r);
               const canonicalIds = normalizedRaw.map(a => a.id).filter(Boolean);
 
               // If parent already has these sheet_asset_ids in same order, skip merging
               const parentSheetIds = Array.isArray(subject?.sheet_asset_ids) ? subject.sheet_asset_ids : (Array.isArray(subject?.sheet_asset_ids) ? subject.sheet_asset_ids : []);
               if (parentSheetIds && arraysEqual(parentSheetIds, canonicalIds)) {
                 console.log("[GenerateSheetStep] parent already contains canonical sheet_asset_ids -> skipping setSubject merge");
               } else {
                 // Do a safe merge: only update parent if it would change
                 setSubject(prev => {
                   const prevAssets = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
                   const prevSheetIds = Array.isArray(prev?.sheet_asset_ids) ? prev.sheet_asset_ids.slice() : [];
 
                   // If prev already has the same sheet ids (regardless of ordering), avoid change
                   if (arraysEqual(prevSheetIds, canonicalIds)) {
                     console.log("[GenerateSheetStep] setSubject noop - prev already had same sheet_asset_ids");
                     return prev;
                   }
 
                   // Build merged assets: put canonical rows first, then keep other previous assets that aren't duplicates
                   const normalizedIdSet = new Set(normalizedRaw.map(a => a.id));
                   const remaining = prevAssets.filter(a => !normalizedIdSet.has(a.id));
                   const merged = [...normalizedRaw, ...remaining];
                   const mergedSubject = { ...(prev || {}), assets: merged, sheet_asset_ids: canonicalIds };
                   console.log('[GenerateSheetStep] merged canonical sheet assets into parent subject; sheet_count=', normalizedRaw.length);
                   return mergedSubject;
                 });
               }
             }
 
             // Clear enqueue guard so overlay hides faster (if parent provided a handler)
             if (typeof clearLastEnqueue === "function") {
               try {
                 clearLastEnqueue();
                 console.log('[GenerateSheetStep] cleared lastEnqueueRef by child request');
               } catch (e) {
                 console.warn('[GenerateSheetStep] clearLastEnqueue call failed', e);
               }
             }
           } catch (err) {
             console.warn('[GenerateSheetStep] merging canonical assets into parent failed', err);
           }
 
           // done (we have canonical assets)
           return;
         }
         // wait before next attempt
         await new Promise((r) => setTimeout(r, intervalMs));
       }
       // If we exhausted attempts, leave sheetAssets as-is (possibly empty)
       console.log("[GenerateSheetStep] finished attempts to fetch canonical sheet assets");
     })();
 
     return () => { aborted = true; };
   // include sheetAssets in deps so we short-circuit if they've already been set
   }, [subjectId, setSubject, clearLastEnqueue, subject, sheetAssets]);
 
   async function generatePreview() {
     if (!subjectId) return alert("No subject");
 
     try { if (typeof clearLock === 'function') clearLock(); } catch (e) { console.warn('clearLock failed', e); }
 
     setIsGenerating(true);
     try {
       const res = await enqueueModelSheet(subjectId, { previewOnly: true });
       if (!res?.ok) {
         alert("Enqueue failed: " + (res?.error || JSON.stringify(res)));
       } else {
         // when enqueued, go to generating-sheet to show overlay; our effect above will attempt to poll canonical assets.
         setStatus("generating-sheet");
         if (typeof showNotification === "function") showNotification("Queued sheet generation — waiting for assets", "info");
       }
     } catch (err) {
       console.error(err);
       alert("Generation failed");
     } finally {
       setIsGenerating(false);
     }
   }

   async function handleSaveAndExit() {
    if (!subjectId) return alert("No subject");
    setIsSaving(true);
    try {
      // Optional: include a name; here we use subject.name as default
      const payload = { name: subject?.name || `Saved ${new Date().toISOString()}` };
      // call save endpoint (you will need to pass auth token or ensure cookies send auth)
      const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/save`, {
        method: "POST",
        credentials: "include", // or send Authorization header with bearer token
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        console.error("Save failed", j);
        alert("Save failed: " + (j?.error || JSON.stringify(j)));
        setIsSaving(false);
        return;
      }

      // optionally show a notification
      if (typeof showNotification === "function") showNotification("Saved model collection — returning to dashboard", "info");

    //navigate back to dashboard
    // ensure we unset saving state (so UI updates) before navigating
    setIsSaving(false);
    console.log("[GenerateSheetStep] save succeeded, navigating to /dashboard; collectionId=", j?.id);
    try {
      router.push("/dashboard");
    } catch (e) {
      console.warn("[GenerateSheetStep] router.push failed", e);
    }
    } catch (err) {
      console.error("handleSaveAndExit error", err);
      alert("Save failed: " + (err?.message || String(err)));
      setIsSaving(false);
    }
  }
 
   return (
     <div className="max-w-4xl mx-auto">
      <span className="text-medium font-semibold">Preview angles</span>
       <div className="mt-3.5">
         {/* Pass canonical sheetImages if available; SheetPreview will prefer `images` prop */}
         <SheetPreview subjectId={subjectId} subject={subject} images={sheetAssets} />
       </div>
 
       <div>
          <ButtonOrange
            className="text-white rounded mt-3.5"
            onClick={handleSaveAndExit}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save & Exit"}
          </ButtonOrange>
        </div>
      </div>
   );
 }
