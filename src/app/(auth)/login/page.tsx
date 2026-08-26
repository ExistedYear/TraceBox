import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return <Suspense fallback={<div className="h-[480px] w-full max-w-md animate-pulse rounded-xl border border-border bg-card/50" />}><AuthForm mode="login" /></Suspense>;
}
