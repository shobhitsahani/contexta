"use client";

import * as React from "react";
import { type Provider } from "@contexta/shared";
import { settingsApi, usageApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Key,
  ShieldCheck,
  AlertCircle,
  CheckCircle,
  Lock,
  Eye,
  EyeOff,
  Info,
  Trash2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface ProviderOption {
  value: Provider;
  label: string;
  defaultModel: string;
  placeholder: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    value: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-1.5-flash",
    placeholder: "AIzaSy...",
  },
  {
    value: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    placeholder: "sk-proj-...",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-3-5-haiku-latest",
    placeholder: "sk-ant-...",
  },
];

export default function SettingsPage() {
  const [usage, setUsage] = React.useState<{
    freeTokensUsed: number;
    freeTokensCap: number;
    freeTokensRemaining: number;
    hasOwnKey: boolean;
    keyRequired: boolean;
  } | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [provider, setProvider] = React.useState<Provider>("gemini");
  const [apiKey, setApiKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [configuredProviders, setConfiguredProviders] = React.useState<Provider[]>([]);

  const fetchUsageAndKeys = React.useCallback(async () => {
    try {
      const u = await usageApi.get();
      setUsage(u);
    } catch {
      // Mock fallback
      setUsage({
        freeTokensUsed: 12450,
        freeTokensCap: 50000,
        freeTokensRemaining: 37550,
        hasOwnKey: false,
        keyRequired: false,
      });
    }

    try {
      const p = await settingsApi.listProviderKeys();
      if (Array.isArray(p)) {
        setConfiguredProviders(p.map((item: { provider: Provider }) => item.provider));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchUsageAndKeys();
  }, [fetchUsageAndKeys]);

  const hasOwnKey = usage?.hasOwnKey || configuredProviders.length > 0;
  const freeTokensUsed = usage?.freeTokensUsed ?? 12450;
  const freeTokensCap = usage?.freeTokensCap ?? 50000;
  const remaining = Math.max(0, freeTokensCap - freeTokensUsed);
  const pct = Math.min(100, Math.round((freeTokensUsed / freeTokensCap) * 100));

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setError("");
    setSaving(true);
    try {
      await settingsApi.setProviderKey({ provider, apiKey: apiKey.trim() });
      setSaved(true);
      setApiKey("");
      if (!configuredProviders.includes(provider)) {
        setConfiguredProviders([...configuredProviders, provider]);
      }
      setTimeout(() => setSaved(false), 2500);
      await fetchUsageAndKeys();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to validate or save provider key.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (prov: Provider) => {
    if (!window.confirm(`Remove saved API key for ${prov}?`)) return;
    try {
      await settingsApi.deleteProviderKey(prov);
      setConfiguredProviders(configuredProviders.filter((p) => p !== prov));
      await fetchUsageAndKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove key.");
    }
  };

  const selectedProviderOption =
    PROVIDERS.find((p) => p.value === provider) || PROVIDERS[0];

  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Settings & Usage
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your LLM provider credentials, review your free-tier token quota, and security controls.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Free Token Allowance & Quota Card */}
      <Card className="shadow-xs border-border/80">
        <CardHeader className="pb-3 pt-5 px-5 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Free Token Allowance</CardTitle>
            <CardDescription className="text-xs">
              Every user receives an initial token budget before needing a personal LLM API key.
            </CardDescription>
          </div>
          <Badge
            variant={hasOwnKey ? "indigo" : "default"}
            className="text-xs py-0.5 px-2.5"
          >
            {hasOwnKey ? "BYOK Active" : "Free Tier"}
          </Badge>
        </CardHeader>

        <CardContent className="px-5 pb-5">
          {loading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-2 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tracking-tight text-foreground">
                    {remaining.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    tokens remaining of {freeTokensCap.toLocaleString()} cap
                  </span>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {pct}% used
                </span>
              </div>

              {/* Quota Progress Bar */}
              <div className="w-full bg-accent rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    pct > 90
                      ? "bg-destructive"
                      : pct > 70
                      ? "bg-amber-500"
                      : "bg-indigo-600"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Used: {freeTokensUsed.toLocaleString()} tokens (~{Math.round(freeTokensUsed / 4500)} questions)</span>
                <span>Max allowance: {freeTokensCap.toLocaleString()} tokens</span>
              </div>

              {!hasOwnKey && remaining <= 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Free allowance reached:</span> You have used all free tokens. Add your personal LLM API key below to continue chatting without limits.
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* BYOK (Bring Your Own Key) Card */}
      <Card className="shadow-xs border-border/80">
        <CardHeader className="pb-3 pt-5 px-5">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-indigo-600" />
            <CardTitle className="text-base font-semibold">
              Bring Your Own Key (BYOK)
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Connect your own API key to use OpenAI, Google Gemini, or Anthropic models directly.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 pb-5 space-y-5">
          {/* Active Configured Providers */}
          {configuredProviders.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-accent/30 p-3.5 space-y-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Saved Provider Keys
              </span>
              <div className="space-y-1.5">
                {configuredProviders.map((prov) => (
                  <div
                    key={prov}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-card border border-border text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                      <span className="font-medium capitalize text-foreground">
                        {prov}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        (Active &amp; verified)
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] text-destructive hover:bg-destructive/10 px-2"
                      onClick={() => handleDeleteKey(prov)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      <span>Remove</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Provider Selection Tabs */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">
              Select Provider
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PROVIDERS.map((p) => {
                const isSelected = provider === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setProvider(p.value)}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 ring-1 ring-indigo-600 shadow-xs"
                        : "border-border hover:border-border/80 hover:bg-accent/40 bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-foreground">
                        {p.label}
                      </span>
                      {isSelected && (
                        <div className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-1">
                      Default: {p.defaultModel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* API Key Form */}
          <form onSubmit={handleSaveKey} className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  {selectedProviderOption.label} API Key
                </label>
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <span>{showKey ? "Hide" : "Show"}</span>
                </button>
              </div>

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder={selectedProviderOption.placeholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={saving}
                  className="pl-9 text-xs font-mono bg-accent/20"
                />
              </div>
            </div>

            {/* Encryption & Security Note */}
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-accent/30 p-3 rounded-lg border border-border/50">
              <ShieldCheck className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Your key is tested with a minimal verification call before saving, and stored encrypted with <strong>AES-256-GCM</strong>. Keys are never logged and never exposed back to the browser.
              </p>
            </div>

            <Button
              type="submit"
              disabled={saving || !apiKey.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-4 shadow-xs"
            >
              {saving ? (
                "Validating & saving..."
              ) : saved ? (
                <>
                  <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-400" />
                  <span>Key Saved!</span>
                </>
              ) : (
                <>
                  <Key className="h-3.5 w-3.5 mr-1" />
                  <span>Save &amp; Activate Key</span>
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Model & Privacy Disclosure Card */}
      <Card className="shadow-xs border-border/80">
        <CardHeader className="pb-3 pt-5 px-5">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-indigo-600" />
            <CardTitle className="text-base font-semibold">
              Privacy &amp; Data Disclosure
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 text-xs text-muted-foreground space-y-2 leading-relaxed">
          <p>
            On the free tier, document passages and queries are processed using Google&apos;s Gemini API free tier. Under Google&apos;s free tier terms, processed content may be used to improve Google products.
          </p>
          <p>
            For private or enterprise documents, configure your own BYOK key (Google Gemini Paid, OpenAI, or Anthropic). Paid provider keys ensure zero model training retention per standard enterprise API terms.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
