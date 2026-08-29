import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !isMissingAuthSession(error)) {
      console.error("Session refresh lookup failed", { code: error.code, message: error.message });
      return response;
    }
    user = data.user;
  } catch (error) {
    console.error("Session refresh request failed", { error: error instanceof Error ? error.message : "unknown" });
    return response;
  }
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = pathname.startsWith("/dashboard") || pathname === "/onboarding";
  const isAuthRoute = pathname === "/login" || pathname === "/signup";

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value, c);
    });
    return redirectResponse;
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value, c);
    });
    return redirectResponse;
  }

  return response;
}
