"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check, Plus } from "lucide-react";
import { ProviderCard } from "./ProviderCard";
import { addOllamaProvider, addOpenAiProvider, listLlmProviders, setDefaultLlmModel, type LlmProviderRow } from "./actions";

export function LlmProvidersPanel({
  initialProviders,
  initialDefaultModelId,
}: {
  initialProviders: LlmProviderRow[];
  initialDefaultModelId: string | null;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [defaultModelId, setDefaultModelIdState] = useState(initialDefaultModelId ?? "");
  const [isSavingDefault, startSavingDefault] = useTransition();
  const [defaultSaved, setDefaultSaved] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<"ollama" | "openai">("ollama");
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiBaseUrl, setNewApiBaseUrl] = useState("");
  const [isAdding, startAdding] = useTransition();
  const [addError, setAddError] = useState<string | null>(null);

  async function refresh() {
    setProviders(await listLlmProviders());
  }

  function addProvider() {
    setAddError(null);
    startAdding(async () => {
      try {
        if (newType === "ollama") {
          if (!newBaseUrl.trim()) throw new Error("Base URL is required.");
          await addOllamaProvider(newName, newBaseUrl.trim());
        } else {
          if (!newApiKey.trim()) throw new Error("API key is required.");
          await addOpenAiProvider(newName, newApiKey.trim(), newApiBaseUrl.trim());
        }
        setNewName("");
        setNewBaseUrl("");
        setNewApiKey("");
        setNewApiBaseUrl("");
        setShowAddForm(false);
        await refresh();
      } catch (e) {
        setAddError(e instanceof Error ? e.message : "Failed to add provider.");
      }
    });
  }

  const NONE_VALUE = "__none__";

  function saveDefault(value: string) {
    setDefaultModelIdState(value);
    setDefaultSaved(false);
    startSavingDefault(async () => {
      await setDefaultLlmModel(value === NONE_VALUE ? null : value);
      setDefaultSaved(true);
    });
  }

  // Every registered model is eligible as the org default, not just
  // user-enabled ones -- an admin can default everyone to a model
  // without also letting users switch away from it (see LlmModel.
  // enabledForUsers's schema comment).
  const allModels = providers.flatMap((p) => p.models.map((m) => ({ id: m.id, label: `${p.name}: ${m.modelId}` })));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect an LLM backend (Ollama, or any OpenAI-compatible API), register which of its models exist, and
        choose which ones users can pick for themselves. Used for AI rule matching, draft/auto-reply generation, and
        the chat assistant.
      </p>

      <div className="space-y-3">
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} onChange={refresh} />
        ))}
      </div>

      {showAddForm ? (
        <div className="rounded-lg border border-dashed p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={newType} onValueChange={(v) => setNewType(v as "ollama" | "openai")}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="openai">OpenAI (or compatible)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={newType === "ollama" ? "Local Ollama" : "OpenAI"} />
            </div>
          </div>

          {newType === "ollama" ? (
            <div className="mt-3">
              <label className="text-xs font-medium text-muted-foreground">Base URL</label>
              <Input className="mt-1" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} placeholder="http://ollama:11434" />
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">API key</label>
                <Input type="password" className="mt-1" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">API base URL (optional)</label>
                <Input className="mt-1" value={newApiBaseUrl} onChange={(e) => setNewApiBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
              </div>
            </div>
          )}

          {addError && <p className="mt-2 text-xs text-destructive">{addError}</p>}

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" disabled={isAdding} onClick={addProvider}>
              {isAdding ? <Loader2 className="animate-spin" /> : null}
              Add provider
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddForm(false)} disabled={isAdding}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
          <Plus /> Add provider
        </Button>
      )}

      <div className="border-t pt-4">
        <label className="text-sm font-medium">Instance default model</label>
        <p className="text-xs text-muted-foreground">
          What every user gets unless they pick something else for themselves in their own Settings.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Select value={defaultModelId || NONE_VALUE} onValueChange={saveDefault}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="None set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>No default (env fallback)</SelectItem>
              {allModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSavingDefault ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          {defaultSaved && !isSavingDefault && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
