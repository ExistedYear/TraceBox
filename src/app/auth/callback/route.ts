import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { getSafeRedirectPath } from "@/lib/utils";
import type { Database } from "@/types/database";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const requestedNext = requestUrl.searchParams.get("next");
  const defaultNext = (type === "signup" || type === "email") ? "/onboarding" : "/dashboard";
  const next = getSafeRedirectPath(requestedNext || defaultNext);

  if (code || (token_hash && type)) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));

    const response = NextResponse.redirect(new URL(next, requestUrl.origin));
    const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    });

    let authError = null;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      authError = error;
    } else if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });
      authError = error;
    }

    if (!authError) {
      let finalTarget = next;
      // If user has no workspaces and is going to /dashboard or default path, redirect to /onboarding
      if (!requestedNext || next === "/dashboard") {
        const { data: membershipRows } = await supabase.from("organization_members").select("organization_id").limit(1);
        if (!membershipRows || membershipRows.length === 0) {
          finalTarget = "/onboarding";
        }
      }
      if (finalTarget !== next) {
        const redirectResponse = NextResponse.redirect(new URL(finalTarget, requestUrl.origin));
        response.cookies.getAll().forEach((c) => {
          redirectResponse.cookies.set(c.name, c.value, c);
        });
        return redirectResponse;
      }
      return response;
    }
    console.error("Supabase auth callback failed", { code: authError.code, message: authError.message });
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));
}

