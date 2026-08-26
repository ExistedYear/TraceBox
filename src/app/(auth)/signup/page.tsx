import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return <Suspense fallback={<div className="h-[520px] w-full max-w-md animate-pulse rounded-xl border border-border bg-card/50" />}><AuthForm mode="signup" /></Suspense>;
}
