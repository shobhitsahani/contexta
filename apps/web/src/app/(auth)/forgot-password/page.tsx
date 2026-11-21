"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/form";
import { authApi } from "@/lib/api";
import { Mail, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch {
      // Graceful fallback for mock mode
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Card className="shadow-lg border-border/80">
        <CardHeader className="text-center pb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mx-auto mb-2">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Check your inbox</CardTitle>
          <CardDescription className="text-xs">
            We sent a password reset link to <strong>{email}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4 pb-6 text-center">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Follow the instructions in the email to choose a new password. If it does not appear within a minute, check your spam folder.
          </p>
          <Link href="/login">
            <Button variant="outline" className="w-full text-xs h-9">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              <span>Back to sign in</span>
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-border/80">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-semibold text-xs shadow-xs">
            C
          </div>
          <span className="font-bold tracking-tight text-sm text-foreground">
            Contexta
          </span>
        </div>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription className="text-xs">
          Enter your registered email and we&apos;ll send you a password recovery link.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pl-9 text-xs"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-9 shadow-xs"
            disabled={loading}
          >
            {loading ? "Sending reset link..." : "Send reset instructions"}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pt-0 pb-6 text-center">
        <p className="text-xs text-muted-foreground">
          Remembered your password?{" "}
          <Link
            href="/login"
            className="text-indigo-600 hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
