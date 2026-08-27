"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Github, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { getSafeAuthErrorMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/utils";
import { loginSchema, signupSchema, type LoginValues, type SignupValues } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type AuthFormProps = { mode: "login" | "signup" };

export function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === "signup";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const form = useForm<LoginValues | SignupValues>({ resolver: zodResolver(isSignup ? signupSchema : loginSchema), defaultValues: isSignup ? { displayName: "", email: "", password: "", confirmPassword: "" } : { email: "", password: "" } });
  const displayNameError = (form.formState.errors as { displayName?: { message?: string } }).displayName;

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam === "auth_callback") {
      toast.error("Could not authenticate with GitHub. Ensure GitHub OAuth is enabled in Supabase.");
    }
  }, [searchParams]);
  async function onSubmit(values: LoginValues | SignupValues) {
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      if (isSignup) {
        const signupValues = values as SignupValues;
        const { data, error } = await supabase.auth.signUp({ email: signupValues.email, password: signupValues.password, options: { data: { display_name: signupValues.displayName }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
        if (error) throw error;
        if (data.session) {
          toast.success("Your account is ready.");
          router.push("/dashboard");
          router.refresh();
        } else {
          toast.success("Account created. Check your email to confirm it, then log in.");
          router.push("/login");
        }
      } else {
        const loginValues = values as LoginValues;
        const { error } = await supabase.auth.signInWithPassword(loginValues);
        if (error) throw error;
        toast.success("Welcome back.");
        router.push(getSafeRedirectPath(searchParams.get("next")));
        router.refresh();
      }
    } catch (error) {
      const message = error instanceof Error ? getSafeAuthErrorMessage(error.message) : "Something went wrong. Please try again.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function continueWithGithub() {
    setIsGithubLoading(true);
    try {
      const supabase = createClient();
      const requestedNext = getSafeRedirectPath(searchParams.get("next"));
      const { error } = await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(requestedNext)}` } });
      if (error) throw error;
    } catch (error) {
      toast.error(error instanceof Error ? getSafeAuthErrorMessage(error.message) : "GitHub sign-in is not available yet.");
      setIsGithubLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-[420px] rounded-[10px] border-border/80 bg-card shadow-xl shadow-black/10">
      <CardHeader className="space-y-3"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">{isSignup ? "New workspace" : "Secure access"}</p><CardTitle className="text-2xl tracking-tight">{isSignup ? "Create your account" : "Welcome back"}</CardTitle><CardDescription>{isSignup ? "Set up your TraceBox workspace in a few seconds." : "Log in to continue to your workspace."}</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {isSignup && <div className="space-y-2"><Label htmlFor="displayName">Display name</Label><Input id="displayName" autoComplete="name" placeholder="your full name" {...form.register("displayName" as const)} />{displayNameError && <p className="text-xs text-destructive">{displayNameError.message}</p>}</div>}
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" placeholder="name@company.com" {...form.register("email")} />{form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}</div>
          <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password">Password</Label>{!isSignup && <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>}</div><Input id="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} placeholder="enter password" {...form.register("password")} />{form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}</div>
          {isSignup && <div className="space-y-2"><Label htmlFor="confirmPassword">Confirm password</Label><Input id="confirmPassword" type="password" autoComplete="new-password" placeholder="enter password again" {...form.register("confirmPassword" as const)} />{(form.formState.errors as { confirmPassword?: { message?: string } }).confirmPassword && <p className="text-xs text-destructive">{(form.formState.errors as { confirmPassword?: { message?: string } }).confirmPassword?.message}</p>}</div>}
          <Button type="submit" className="w-full" disabled={isSubmitting || isGithubLoading}>{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}{isSignup ? "Create account" : "Log in"}</Button>
        </form>
        <div className="relative my-6"><Separator /><span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">or</span></div>
        <Button type="button" variant="outline" className="w-full" onClick={continueWithGithub} disabled={isSubmitting || isGithubLoading}><Github className="h-4 w-4" />{isGithubLoading && <Loader2 className="h-4 w-4 animate-spin" />}Continue with GitHub</Button><p className="mt-2 text-center text-[11px] text-muted-foreground">GitHub sign-in requires the workspace deployment to enable the provider.</p>
        <p className="mt-6 text-center text-sm text-muted-foreground">{isSignup ? "Already have an account?" : "Need an account?"}{" "}<Link href={isSignup ? "/login" : "/signup"} className="font-medium text-primary hover:underline">{isSignup ? "Log in" : "Sign up"}</Link></p>
      </CardContent>
    </Card>
  );
}
