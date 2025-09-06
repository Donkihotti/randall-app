// src/app/api/subject/list/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export async function GET(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
    if (!token) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const userId = userData.user.id;

    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Subjects list error:", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, subjects: data });
  } catch (err) {
    console.error("GET /api/subject/list error:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
