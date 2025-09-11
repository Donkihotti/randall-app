// src/app/api/subject/[id]/save/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "../../../../../../utils/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only key
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.warn("SUPABASE env missing for save route");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/*
  POST /api/subject/:id/save
  body: { name?: string, includeAssetIds?: string[] }  // includeAssetIds optional override
  - The endpoint will:
    1) validate the user (adapt to your auth method)
    2) fetch canonical assets for subject (prefer sheet_asset_ids, then select assets of group=sheet)
    3) pick an "original" asset if present (latest_asset_ids / generated_face / preview)
    4) insert a saved_collections row referencing the asset ids
    5) return { ok:true, id: <collectionId> }
*/
export async function POST(request, { params }) {
  try {
    // params is synchronous — don't await it
    const { id: subjectId } = await params;
    if (!subjectId) {
      return NextResponse.json({ ok: false, error: "Missing subject id" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const name = body?.name || null;
    const includeAssetIdsOverride = Array.isArray(body?.includeAssetIds) ? body.includeAssetIds : null;

    // --- Authenticate
    // 1) Try cookie-based session via createServerSupabase() helper (preferred for browser requests with cookies)
    // 2) Fallback: accept Authorization: Bearer <access_token>
    let userId = null;
    try {
      // create server supabase client bound to request cookies (reads Supabase session cookie if present)
      const serverSupabase = await createServerSupabase();
      // supabase.auth.getUser() will check the session token bound to this server client
      const { data: userData, error: userErr } = await serverSupabase.auth.getUser();
      if (!userErr && userData?.user?.id) {
        userId = userData.user.id;
        console.log("[save route] authenticated via cookie, userId=", userId);
      } else if (userErr) {
        console.log("[save route] serverSupabase.auth.getUser() returned error", userErr);
     }
   } catch (e) {
     console.warn("[save route] createServerSupabase/getUser failed:", e);
   }
   // fallback: Authorization header with bearer token
   if (!userId) {
     const authHeader = request.headers.get("authorization") || "";
     const bearer = authHeader.replace("Bearer ", "").trim();
     if (bearer) {
       try {
         const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(bearer);
         if (!userErr && userData?.user?.id) {
           userId = userData.user.id;
            console.log("[save route] authenticated via bearer token, userId=", userId);
          } else {
            console.log("[save route] supabaseAdmin.auth.getUser returned error or no user", userErr);
          }
        } catch (e) {
          console.warn("[save route] supabaseAdmin.getUser(bearer) failed:", e);
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized: missing valid auth" }, { status: 401 });
    }

    // Step 1: fetch subject row (to determine pointers like sheet_asset_ids / latest_asset_ids).
    const { data: subjectRows, error: subjErr } = await supabaseAdmin
      .from("subjects")
      .select("id, owner_id, sheet_asset_ids, latest_asset_ids")
      .eq("id", subjectId)
      .limit(1)
      .maybeSingle();

    if (subjErr || !subjectRows) {
      return NextResponse.json({ ok: false, error: "Subject not found" }, { status: 404 });
    }
    if (subjectRows.owner_id !== userId) {
      // not the owner: deny
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Step 2: figure out canonical asset ids to save
    let chosenAssetIds = [];
    if (includeAssetIdsOverride && includeAssetIdsOverride.length) {
      chosenAssetIds = includeAssetIdsOverride;
    } else if (Array.isArray(subjectRows.sheet_asset_ids) && subjectRows.sheet_asset_ids.length > 0) {
      chosenAssetIds = subjectRows.sheet_asset_ids;
    } else if (Array.isArray(subjectRows.latest_asset_ids) && subjectRows.latest_asset_ids.length > 0) {
      // include original latest asset plus any sheet-like assets (if present)
      chosenAssetIds = [...subjectRows.latest_asset_ids];
    } else {
      // fallback: query assets for subject and pick sheet-like + generated_face assets
      const { data: assetsForSubject, error: assetsErr } = await supabaseAdmin
        .from("assets")
        .select("id, type")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false });

      if (!assetsErr && Array.isArray(assetsForSubject) && assetsForSubject.length) {
        // prefer sheet_face/body first, then generated_face
        const sheet = assetsForSubject.filter(a => ["sheet_face","sheet_body"].includes(a.type)).map(a => a.id);
        const gen = assetsForSubject.filter(a => ["generated_face","preview"].includes(a.type)).map(a => a.id);
        chosenAssetIds = [...sheet, ...gen].slice(0, 12);
      }
    }

    if (!chosenAssetIds || !chosenAssetIds.length) {
      return NextResponse.json({ ok: false, error: "No assets found to save" }, { status: 400 });
    }

    // Step 3: create saved_collections record
    const insertPayload = {
      owner_id: userId,
      subject_id: subjectId,
      name,
      asset_ids: JSON.stringify(chosenAssetIds),
      metadata: {},
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("saved_collections")
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr || !inserted) {
      console.error("save collection insert err", insertErr);
      return NextResponse.json({ ok: false, error: "Failed to save collection" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error("save route error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
