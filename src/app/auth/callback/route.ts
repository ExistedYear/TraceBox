import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeRedirectPath } from "@/lib/utils";
import type { Database } from "@/types/database";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  const next = getSafeRedirectPath(requestedNext);

  if (code) {
    const response = NextResponse.redirect(new URL(next, requestUrl.origin));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));
    const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
    console.error("Supabase auth callback failed", { code: error.code, message: error.message });
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));
}
