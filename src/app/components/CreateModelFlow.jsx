"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import UploadStep from "./steps/UploadStep";
import GenerateSheetStep from "./steps/GenerateSheetStep";
import GenerateStep from "./steps/GenerateStep";
import UpscaleStep from "./steps/UpscaleStep";
import FinalizeStep from "./steps/FinalizeStep";
import ProgressBar from "./ProgressBar";
import BottomNotification from "./BottomNotification";
import ChoiceStep from "./steps/ChoiceStep";
import GeneratePreviewStep from "./steps/GeneratePreviewStep";

import { getSubjectStatus } from "../../../lib/apiClient";
import { pickAssetUrl } from "../../../lib/pickAsset";
import { getBrowserSupabase } from "../../../lib/supabaseBrowser"

/*
  CreateModelFlow - expects optional prop initialName (string)
*/

export default function CreateModelFlow({ initialName = "" }) {
  const router = useRouter();

  const STEPS = [
    "choose",
    "generate",
    "generate-preview",
    "uploading",
    "validating",
    "generating-sheet",
    "sheet-preview",
    "upscaling",
    "finalize",
    "ready",
  ];

  const [status, setStatus] = useState("choose");
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status }, [status]);

  const [subjectId, setSubjectId] = useState(null);
  const [subject, setSubject] = useState(null);
  const [polling, setPolling] = useState(false);
  const [localPreviewImages, setLocalPreviewImages] = useState([]); // [{url, meta}]

  const [showExitModal, setShowExitModal ] = useState(false); 
  const [nextPath, setNextPath] = useState(null);

  const previewLockRef = useRef(null);
  const previewForcedRef = useRef(null);
  
  const pollIntervalRef = useRef(null); // holds the active polling interval id so we can clear it when realtime arrives

  // Supabase realtime subscription management
  const realtimeChannelRef = useRef(null);
  const subscriptionActiveRef = useRef(false); // used to short-circuit polling when realtime is active

  // small refs used to protect UI transitions from poll overrides
  const lastEnqueueRef = useRef(null);       // timestamp of last enqueue
  const userLockRef = useRef(null);          // for user-initiated locks (upscaling etc)

  function lockTo(step, durationMs = 60000) {
    userLockRef.current = { step, until: Date.now() + durationMs };
  }
  function clearLock() { userLockRef.current = null; }
  function isLocked() { return userLockRef.current && userLockRef.current.until > Date.now(); }

  // helper to clear lastEnqueue (exposed to children)
  function clearLastEnqueue() {
    lastEnqueueRef.current = null;
    console.log('[createFlow] cleared lastEnqueueRef by child request');
  }

   // --- helper to fetch canonical assets for the subject (single source of truth)
  async function fetchCanonicalAssets(sid, opts = {}) {
    if (!sid) return [];
    try {
      const q = opts.group ? `?group=${encodeURIComponent(opts.group)}` : '';
      const res = await fetch(`/api/subject/${encodeURIComponent(sid)}/assets${q}`, {
        method: 'GET',
        credentials: 'include'
      });
      if (!res.ok) {
        console.warn('fetchCanonicalAssets: non-ok response', res.status);
        return [];
      }
      const j = await res.json().catch(() => null);
      const assets = Array.isArray(j?.assets) ? j.assets : (Array.isArray(j) ? j : []);
      // also update subject if route returned subject too
      if (j?.subject) setSubject(j.subject);
      return assets;
    } catch (e) {
      console.warn('fetchCanonicalAssets error', e);
      return [];
    }
  }

  // ---- Canonical assets fetch helper ----
  async function fetchCanonicalAssets(subjectIdArg, group = "sheet") {
    if (!subjectIdArg) return [];
    try {
      const res = await fetch(`/api/subject/${encodeURIComponent(subjectIdArg)}/assets?group=${encodeURIComponent(group)}`, { cache: "no-store" });
      if (!res.ok) return [];
      const j = await res.json();
      if (!j?.ok || !Array.isArray(j.assets)) return [];
      return j.assets;
    } catch (e) {
      console.warn('[fetchCanonicalAssets] failed', e);
      return [];
    }
  }

  //accept from preview to sheet generation 
  async function handlePreviewAccept() {
       // Try to find a valid assetId via multiple fallbacks:
       // 1) localPreviewImages (client immediate)
       // 2) subject.latest_asset_ids (canonical pointer)
       // 3) subject.assets (legacy)
       // 4) re-fetch canonical subject from server and retry the above
       const pickFromSubject = (subj) => {
         if (!subj) return null;
         // prefer canonical pointer
         if (Array.isArray(subj.latest_asset_ids) && subj.latest_asset_ids.length > 0) {
           return subj.latest_asset_ids[0];
         }
         // fallback to picking a recent preview-like asset from subj.assets
         const assets = Array.isArray(subj.assets) ? subj.assets : [];
         const candidate = assets
           .filter(a => ["preview","generated_face","generated_face_replicate","sheet_face","sheet_body"].includes(a.type))
           .sort((a,b) => new Date(b.created_at || b.updated_at || b.createdAt || b.updatedAt).getTime() - new Date(a.created_at || a.updated_at || a.createdAt || a.updatedAt).getTime())[0];
         return candidate ? (candidate.id || candidate.assetId || null) : null;
       };
    
       // 1) try local previews first
       const newestLocal = (localPreviewImages && localPreviewImages.length > 0) ? localPreviewImages[0] : null;
       let assetId = newestLocal?.assetId || newestLocal?.id || null;
    
       // 2) try parent subject pointer/state
       if (!assetId) {
         assetId = pickFromSubject(subject);
       }
    
       // 3) If still not found, re-fetch canonical subject state from the server and try again
       if (!assetId && subjectId) {
         try {
           const res = await getSubjectStatus(subjectId);
           if (res?.subject) {
             setSubject(res.subject); // reconcile parent canonical state
             // try to pick an asset from fresh subject
             assetId = pickFromSubject(res.subject);
           }
         } catch (e) {
           console.warn('handlePreviewAccept: failed to fetch subject status', e);
         }
       }
    
       // 4) final attempt: if local preview has a URL and no id, match canonical assets by URL
       if (!assetId && newestLocal?.url && subjectId) {
         try {
           const resAssets = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/assets`, { credentials: "include" });
           if (resAssets.ok) {
             const body = await resAssets.json().catch(() => null);
             const rows = body?.assets || [];
             const match = (rows || []).find(a => {
               const aUrl = a.url || a.signedUrl || a.signedURL || null;
               const aObj = a.object_path || a.objectPath || null;
               const u = newestLocal.url;
               if (!u) return false;
               if (aUrl && aUrl === u) return true;
               if (aObj && u.includes(aObj)) return true;
               return false;
             });
             if (match) {
               assetId = match.id || match.assetId || null;
               // merge canonical assets into parent subject for future clicks
               setSubject(prev => ({ ...(prev || {}), assets: rows }));
             }
           }
         } catch (e) {
           console.warn('handlePreviewAccept: assets fetch/match failed', e);
         }
       }
    
       if (!assetId) {
         showNotification("No preview image selected to accept — wait a moment for the server to persist the image, then try again.", "error");
         return;
       }
    
       // Proceed to accept
       lockTo("generating-sheet", 60 * 1000); // protect UI
       lastEnqueueRef.current = Date.now();
       setStatus("generating-sheet");
       showNotification("Accepting preview — generating sheet...", "info");
    
       try {
         const res = await fetch(`/api/subject/${encodeURIComponent(subjectId)}/assets/${encodeURIComponent(assetId)}/accept`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           credentials: "include",
           body: JSON.stringify({ action: "accept" })
         });
    
         const contentType = res.headers.get("content-type") || "";
         let j = null;
         if (contentType.includes("application/json")) {
           j = await res.json().catch(() => null);
         } else {
           const txt = await res.text().catch(() => null);
           throw new Error("Unexpected response from accept endpoint: " + (txt || "no body"));
         }
    
         if (!res.ok) {
           clearLock();
           setStatus("generate-preview");
           throw new Error(j?.error || "Accept failed");
         }
    
         // Merge returned canonical subject if provided
         if (j?.subject) setSubject(prev => ({ ...(prev || {}), ...(j.subject || {}) }));
    
         if (j?.jobId) lastEnqueueRef.current = Date.now();
    
         showNotification("Preview accepted — sheet generation started", "info");
         // keep status at generating-sheet; realtime/poll will update further when ready
       } catch (err) {
         console.error("handlePreviewAccept error:", err);
         showNotification("Accept failed: " + (err?.message || err), "error");
         clearLock();
         setStatus("generate-preview");
       }
     }

  /**
   * mapServerStatus
   */
  function mapServerStatus(subjectObj) {
    if (!subjectObj) return null;
    const s = String(subjectObj.status || "").toLowerCase();

    if (s === "awaiting-generation" || s === "draft" || s === "awaiting_prompt") return "generate";
    if (s === "queued" || s === "preprocess" || s === "preprocessing" || s === "queued_preprocess") return "validating";
    if (s === "generated" || s === "ready") return "ready";
    if (s === "generating" || s === "running" || s === "processing" || s.includes("queued_generation")) return "generating-sheet";
    if (s.includes("generat") && s !== "generated") return "generating-sheet";
    if (s === "sheet_generated") return "sheet-preview";

    if (s === "awaiting-approval") {
      const assets = Array.isArray(subjectObj.assets) ? subjectObj.assets : [];
      const hasSheet = assets.some(a => ["sheet_face","sheet_body"].includes(a.type));
      if (hasSheet) return "sheet-preview";

      const hasPreview = assets.some(a => ["preview","generated_face","generated_face_replicate","sheet_face","sheet_body"].includes(a.type));
      if (hasPreview) return "generate-preview";

      return "generating-sheet";
    }

    if (["preview_ready"].includes(s)) {
      const assets = Array.isArray(subjectObj.assets) ? subjectObj.assets : [];
      const hasPreview = assets.some(a => ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type));
      if (hasPreview) return "generate-preview";
      return "generating-sheet";
    }

    if (s === "failed" || s === "error") return "failed";
    if (["choose","generate","uploading","validating","generating-sheet","sheet-preview","upscaling","finalize","ready","failed"].includes(s)) {
      return s;
    }
    return null;
  }

  // helper to set/clear preview lock (kept but not heavily used)
  function setPreviewLock(durationMs = 15000, jobId = null) {
    previewLockRef.current = { until: Date.now() + durationMs, jobId };
    console.log('[previewLock] set until=', previewLockRef.current.until, 'jobId=', jobId);
  }
  function clearPreviewLock() {
    previewLockRef.current = null;
    console.log('[previewLock] cleared');
  }
  function isPreviewLocked() {
    return previewLockRef.current && previewLockRef.current.until > Date.now();
  }

  // notifications
  const [notif, setNotif] = useState({ visible: false, message: "", type: "info" });
  const notifTimerRef = useRef(null);
  function showNotification(message, type = "info", timeoutMs = 4000) {
    if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
    setNotif({ visible: true, message, type });
    notifTimerRef.current = setTimeout(() => setNotif((p) => ({ ...p, visible: false })), timeoutMs);
  }
  useEffect(() => () => { if (notifTimerRef.current) clearTimeout(notifTimerRef.current); }, []);

  // If initialName passed (from dashboard), prefill subject and stay in choose step
  useEffect(() => {
    if (initialName) {
      setSubject(prev => ({ ...(prev || {}), name: initialName }));
      setStatus("choose");
    }
  }, [initialName]);

  // Supabase Realtime subscription for assets for this subject (fast updates)
  useEffect(() => {
    if (!subjectId) return;

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.warn('[realtime] NEXT_PUBLIC_SUPABASE_* not found — realtime disabled');
      return;
    }

    const supabase = getBrowserSupabase();

    const filter = `subject_id=eq.${subjectId}`;

    // NOTE: use async IIFE so we can await subscribe and mark active
    let channel = null;
    (async () => {
      try {
        channel = supabase.channel(`assets-sub-${subjectId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assets', filter }, async (payload) => {
            const newRow = payload?.new || payload?.record || null;
            if (!newRow) return;

            // If this looks like a sheet asset -> reconcile canonical list for ordering/signatures
            const looksLikeSheet = (newRow?.meta && newRow.meta.group === 'sheet') || ["sheet_face","sheet_body"].includes(newRow?.type);
            if (looksLikeSheet) {
              const canonical = await fetchCanonicalAssets(subjectId, 'sheet');
              if (canonical && canonical.length) {
                setSubject(prev => ({ ...(prev || {}), assets: canonical }));
                lastEnqueueRef.current = null; // clear overlay guard
                return;
              }
            }

            // Otherwise merge this asset in (avoid duplication)
            setSubject(prev => {
              const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
              if (!existing.some(a => a.id === newRow.id)) {
                return { ...(prev || {}), assets: [newRow, ...existing] };
              }
              return prev;
            });

            // clear overlay guard if sheet-like
            if (looksLikeSheet) lastEnqueueRef.current = null;
            console.log('[realtime] asset inserted', newRow.id, newRow.type, newRow.meta);
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assets', filter }, async (payload) => {
            const updated = payload?.new || payload?.record || null;
            if (!updated) return;

            const looksLikeSheet = (updated?.meta && updated.meta.group === 'sheet') || ["sheet_face","sheet_body"].includes(updated?.type);
            if (looksLikeSheet) {
              const canonical = await fetchCanonicalAssets(subjectId, 'sheet');
              if (canonical && canonical.length) {
                setSubject(prev => ({ ...(prev || {}), assets: canonical }));
                lastEnqueueRef.current = null;
                return;
              }
            }

            setSubject(prev => {
              const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
              const idx = existing.findIndex(a => a.id === updated.id);
              if (idx === -1) {
                return { ...(prev || {}), assets: [updated, ...existing] };
              } else {
                existing[idx] = updated;
                return { ...(prev || {}), assets: existing };
              }
            });
            if (looksLikeSheet) lastEnqueueRef.current = null;
            console.log('[realtime] asset updated', updated.id, updated.type, updated.meta);
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'assets', filter }, (payload) => {
            const oldRow = payload?.old || payload?.record || null;
            if (!oldRow) return;
            setSubject(prev => {
              const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
              const filtered = existing.filter(a => a.id !== oldRow.id);
              return { ...(prev || {}), assets: filtered };
            });
            console.log('[realtime] asset deleted', oldRow.id);
          });

        await channel.subscribe();
        realtimeChannelRef.current = channel;
        subscriptionActiveRef.current = true;
        console.log('[realtime] subscribed to assets for subject', subjectId);
      } catch (err) {
        console.warn('[realtime] subscription error', err);
      }
    })();

    // cleanup on unmount or subject change
    return () => {
      (async () => {
        try {
          if (realtimeChannelRef.current) {
            await supabase.removeChannel(realtimeChannelRef.current);
          } else if (channel) {
            try { await supabase.removeChannel(channel); } catch (e) {}
          }
        } catch (e) {
          console.warn('[realtime] cleanup error', e);
        } finally {
          realtimeChannelRef.current = null;
          subscriptionActiveRef.current = false;
        }
      })();
    };
  }, [subjectId]);

  // Poll subject status (if we have an id) — fallback when realtime not active
  useEffect(() => {
    if (!subjectId) return;
    if (polling) return;
    if (subscriptionActiveRef.current) {
      console.log('[poll] realtime active -> skipping poll');
      return;
    }
    setPolling(true);
    let mounted = true;

    const doPoll = async () => {
      if (subscriptionActiveRef.current) {
        if (mounted) setPolling(false);
        return;
      }
      try {
        const res = await getSubjectStatus(subjectId);
        if (!mounted || !res?.subject) return;

        console.log('[poll] subjectId=', subjectId,
          'serverStatus=', res.subject.status,
          'lastEnqueue=', lastEnqueueRef.current,
          'previewLockUntil=', previewLockRef.current ? previewLockRef.current.until : null,
          'clientStatus=', statusRef.current
        );

        setSubject(res.subject);

        // If server now has sheet assets, clear lastEnqueue to let overlay go
        const serverAssets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
        const serverHasSheetAssets = serverAssets.some(a => ["sheet_face","sheet_body"].includes(a.type) || (a.meta && a.meta.group === 'sheet'));
        if (serverHasSheetAssets && lastEnqueueRef.current) {
          console.log('[poll] server has sheet assets -> clearing lastEnqueueRef so overlay can hide');
          lastEnqueueRef.current = null;
        }

        const mapped = mapServerStatus(res.subject);
        if (!mapped) {
          console.log('[poll] map returned null');
          return;
        }

        // preview lock handling (keep for brief protection)
        if (isPreviewLocked()) {
          const assets = serverAssets;
          const serverHasPreview = assets.some(a =>
            ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
          );

          if (serverHasPreview) {
            console.log('[poll] server has persisted preview -> clearing previewLock and applying mapping');
            clearPreviewLock();
          } else {
            if (statusRef.current !== 'generate-preview') {
              console.log('[poll] previewLock active -> forcing generate-preview');
              setStatus('generate-preview');
            }
            return;
          }
        }

        if (lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 8000)) {
          if (mapped === 'generate' && (statusRef.current === 'generating-sheet' || statusRef.current === 'generate-preview')) {
            console.log('[poll] ignoring mapped back to generate during recent enqueue');
            return;
          }
        }

        if (isLocked()) {
          const lock = userLockRef.current;
          if (mapped === 'failed' || mapped === 'ready') {
            clearLock();
            setStatus(mapped);
            return;
          }
          if (mapped === lock.step) return;
          console.log('[poll] userLock active -> ignoring mapping');
          return;
        }

        if (mapped === 'generate-preview' || mapped === 'sheet-preview') {
          const assets = serverAssets;
          const hasPreview = assets.some(a => ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type));
          const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);

          if (statusRef.current === 'generating-sheet') {
            console.log('[poll] mapped=' + mapped + ' but client is on generating-sheet -> keep generating-sheet');
            return;
          }

          if (!hasPreview && recentlyEnqueued) {
            console.log('[poll] mapped ' + mapped + ' but no assets & recently enqueued => keep generating-sheet');
            setStatus('generating-sheet');
          } else {
            console.log('[poll] mapped ' + mapped + ' => set');
            setStatus(mapped);
          }
          return;
        }

        if (mapped !== statusRef.current) {
          console.log('[poll] applying mapped status:', mapped);
          setStatus(mapped);
        }
      } catch (err) {
        console.error('[poll] error', err);
      }
    };

    doPoll();
    const t = setInterval(doPoll, 2000);
    return () => { mounted = false; clearInterval(t); setPolling(false); };
  }, [subjectId]);

  // helper to create subject
  async function createSubjectIfNeeded(options = {}) {
    if (subjectId) return subjectId;
    try {
      const payload = {
        name: subject?.name || initialName || "Unnamed model",
        consentConfirmed: !!subject?.consent,
        basePrompt: subject?.basePrompt || "",
        draft: !!options.draft,
      };

      const res = await fetch("/api/subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "create subject failed");

      const returnedSubject = j.subject || j.data || null;
      if (!returnedSubject || !returnedSubject.id) {
        const sid = j.subjectId || j.id || j.subject_id;
        if (!sid) throw new Error("Server did not return new subject id");
        setSubjectId(sid);
        setSubject((prev) => ({ ...(prev || {}), id: sid, ...payload }));
        return sid;
      }

      setSubjectId(returnedSubject.id);
      setSubject((prev) => ({ ...(prev || {}), id: returnedSubject.id, ...payload }));
      return returnedSubject.id;
    } catch (err) {
      console.error("createSubjectIfNeeded failed", err);
      showNotification("Failed to create subject: " + (err.message || err), "error");
      throw err;
    }
  }

  // handle user picking "Upload references"
  function handlePickUpload() {
    clearLock();
    if (!subject?.name && !initialName) {
      showNotification("Missing model name — please provide a name before uploading", "error");
      return;
    }
    setStatus("uploading");
    showNotification("Upload references to build a consistent model", "info");
  }

  // handle user picking generate from scratch
  async function handlePickGenerate() {
    clearLock();
    try {
      showNotification("Preparing prompt page...", "info");
      const id = await createSubjectIfNeeded({ draft: true });
      setStatus("generate");
      showNotification("Open the prompt editor to generate references", "info");
    } catch (err) {
      console.error("handlePickGenerate error", err);
      showNotification("Failed to start generate flow: " + (err.message || err), "error");
    }
  }

  function handleSubjectCreated(created) {
    clearLock();
    console.log("handleSubjectCreated", created);
    if (created?.subjectId) {
      setSubjectId(created.subjectId);
      setStatus("validating");
      showNotification("Subject created — validating uploads", "info");
      return;
    }
    if (created?.subject?.id) {
      setSubjectId(created.subject.id);
      setSubject(created.subject);
      setStatus(created.subject.status || "validating");
      showNotification("Subject created", "info");
    }
  }

  // include setSubject and clearLastEnqueue in stepProps so steps can reconcile canonical state
  const stepProps = { subjectId, subject, setStatus, showNotification, clearLock, setSubject, clearLastEnqueue };

  const showGeneratingOverlay = (() => {
      const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);
  
      // If subject contains a canonical pointer sheet_asset_ids use that first
      const hasSheetViaPointer = Array.isArray(subject?.sheet_asset_ids) && subject.sheet_asset_ids.length > 0;
  
      // Fallback: inspect subject.assets for sheet_face (legacy)
      const hasSheetLegacy = Array.isArray(subject?.assets)
        ? subject.assets.some(a => ["sheet_face", "sheet_body"].includes(a.type) || (a.meta && a.meta.group === 'sheet'))
        : false;
  
      const hasSheetAssets = hasSheetViaPointer || hasSheetLegacy;
  
      // show overlay only while generating-sheet AND no sheet assets present,
      // or when we very recently enqueued and no sheet assets yet.
      return (!hasSheetAssets) && (status === "generating-sheet" || recentlyEnqueued);
    })();

    //Exit warning module
    useEffect(() => {
      const handleRouteChange = (url) => {
        // Stop navigation and show modal
        setShowExitModal(true);
        setNextPath(url);
        throw "Navigation cancelled"; // prevent immediate route change
      };
  
      router.events?.on("routeChangeStart", handleRouteChange);
  
      return () => {
        router.events?.off("routeChangeStart", handleRouteChange);
      };
    }, [router]);
  
    const confirmLeave = () => {
      setShowExitModal(false);
      router.push(nextPath); // continue navigation
    };

  return (
    <div className="w-full mx-auto h-full">
      <div className="absolute top-3.5 left-3.5">
        <ProgressBar steps={STEPS} currentStatus={status} />
      </div>

      {showGeneratingOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
          <div className="text-center text-white px-6">
            <div className="mb-4 text-lg font-medium">Generating images…</div>
            <div className="w-12 h-12 border-4 border-default-orange border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        </div>
      )}

      <div className="h-full w-full flex items-center">
        {(() => {
          switch (status) {
            case "choose":
              return <ChoiceStep subject={subject} onPickUpload={handlePickUpload} onPickGenerate={handlePickGenerate} showNotification={showNotification} />;

            case "generate":
              return (
                <GenerateStep
                subjectId={subjectId}
                name={subject?.name || initialName}
                showNotification={showNotification}
                onQueued={async ({
                    jobId,
                    subjectId: sid,
                    images = [],
                    subject: returnedSubject,
                    forcePreview = false,
                  }) => {
                    console.log('[onQueued] jobId:', jobId, 'sid:', sid, 'images.length:', (images || []).length, 'forcePreview:', forcePreview);

                    // Ensure we always set subjectId from child
                    setSubjectId(sid || subjectId);

                    // clear any manual user lock
                    clearLock();

                    // ALWAYS mark an enqueue time so poll can be tolerant for a short time
                    lastEnqueueRef.current = Date.now();

                    // Merge server-sent subject if present (helps with ids & metadata)
                    if (returnedSubject) {
                      setSubject((prev) => ({ ...(prev || {}), ...(returnedSubject || {}) }));
                      console.log('[onQueued] merged returnedSubject (assets length):', (returnedSubject.assets || []).length);
                    }

                    // If API returned immediate images, normalize and show preview
                    if (Array.isArray(images) && images.length > 0) {
                      const normalized = images
                        .map((img) => {
                          const url = pickAssetUrl(img) || img.url || img.objectPath || img.object_path || null;
                          return url ? { url, meta: img.meta || {}, assetId: img.assetId || img.id || null } : null;
                        })
                        .filter(Boolean);

                      setLocalPreviewImages(normalized);
                      setSubject((prev) => {
                        const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
                        const previewAssets = normalized.map((img) => ({
                          type: 'preview',
                          url: img.url,
                          meta: img.meta || {},
                          created_at: new Date().toISOString(),
                        }));
                        return { ...(prev || {}), assets: [...previewAssets, ...existing] };
                      });

                      previewForcedRef.current = Date.now() + 15000; // 15s
                      setStatus('generate-preview');
                      showNotification('Preview generated', 'info');
                      return;
                    }

                    // If server asked to open preview (forcePreview) but there were no immediate images,
                    // try to fetch the canonical assets (they may have already been persisted).
                    if (forcePreview) {
                      setStatus('generate-preview');
                      showNotification('Waiting for preview — opening preview screen', 'info');

                      // attempt to fetch canonical assets and populate local preview images
                      const canonical = await fetchCanonicalAssets(sid);
                      const useful = (canonical || []).filter(a => ["preview", "generated_face", "generated_face_replicate", "sheet_face", "sheet_body"].includes(a.type));
                      if (useful.length) {
                        const normalized = useful.map(a => ({ assetId: a.id, url: pickAssetUrl(a) || a.url || a.signedUrl || a.signedURL || null, meta: a.meta || {} })).filter(Boolean);
                        if (normalized.length) {
                          setLocalPreviewImages(normalized);
                          setSubject(prev => ({ ...(prev || {}), assets: [...normalized.map(n => ({ type: 'preview', url: n.url, meta: n.meta, created_at: new Date().toISOString() })), ...(prev?.assets || [])] }));
                          return;
                        }
                      }
                      // nothing found — let poll/realtime reconcile
                      return;
                    }

                    // Otherwise fall back to queued job path
                    if (jobId) {
                      lastEnqueueRef.current = Date.now();
                      setStatus('generating-sheet');
                      showNotification('Generation queued — waiting for previews', 'info');
                      return;
                    }

                    // conservative fallback
                    lastEnqueueRef.current = Date.now();
                    setStatus('generating-sheet');
                    showNotification('Generation started', 'info');
                  }}
              />
              );

            case "uploading":
            case "validating":
              return <UploadStep initialSubject={subject} onCreated={handleSubjectCreated} {...stepProps} />;

            case "generating-sheet":
              return <GenerateSheetStep {...stepProps} />;

            case "generate-preview":
              return (
                <GeneratePreviewStep
                  subject={subject}
                  subjectId={subjectId}
                  initialPreview={localPreviewImages}
                  showNotification={showNotification}
                  onBack={() => {
                    previewForcedRef.current = null;
                    clearLock();
                    if ((subject?.faceRefs && subject.faceRefs.length) || (subject?.bodyRefs && subject.bodyRefs.length)) {
                      setStatus("uploading");
                    } else {
                      setStatus("generate");
                    }
                  }}
                  onAccept={() => handlePreviewAccept()}
                />
              );

            case "sheet-preview":
              return <GenerateSheetStep {...stepProps} />;

            case "upscaling":
              return <UpscaleStep {...stepProps} />;

            case "finalize":
            case "ready":
              return <FinalizeStep {...stepProps} />;

            case "failed":
              return (
                <div className="p-4 text-red-600">
                  Something failed. Check logs and subject warnings.
                </div>
              );

            default:
              return null;
          }
        })()}
      </div>

      <BottomNotification visible={notif.visible} message={notif.message} type={notif.type} />
      {showExitModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded shadow-lg">
            <p className="mb-4">Are you sure you want to exit?</p>
            <button
              className="px-4 py-2 bg-red-500 text-white rounded mr-2"
              onClick={confirmLeave}
            >
              Yes, leave
            </button>
            <button
              className="px-4 py-2 bg-gray-300 rounded"
              onClick={() => setShowExitModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
