import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectPath } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  const next = getSafeRedirectPath(requestedNext);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, requestUrl.origin));
    console.error("Supabase auth callback failed", { code: error.code, message: error.message });
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));
}
