"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Trash2, Plus } from "lucide-react";
import {
  fetchAvailableModels,
  addModelToProvider,
  setModelEnabledForUsers,
  removeModel,
  removeProvider,
  type LlmProviderRow,
} from "./actions";

export function ProviderCard({ provider, onChange }: { provider: LlmProviderRow; onChange: () => void }) {
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [isFetching, startFetching] = useTransition();
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isBusy, startBusy] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const registeredIds = new Set(provider.models.map((m) => m.modelId));
  const addableModels = (fetchedModels ?? []).filter((id) => !registeredIds.has(id));

  function loadModels() {
    setFetchError(null);
    startFetching(async () => {
      try {
        setFetchedModels(await fetchAvailableModels(provider.id));
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Failed to fetch models.");
      }
    });
  }

  function addModel(modelId: string) {
    startBusy(async () => {
      await addModelToProvider(provider.id, modelId);
      onChange();
    });
  }

  function toggleEnabled(modelId: string, enabled: boolean) {
    startBusy(async () => {
      await setModelEnabledForUsers(modelId, enabled);
      onChange();
    });
  }

  function deleteModel(modelId: string) {
    startBusy(async () => {
      await removeModel(modelId);
      onChange();
    });
  }

  function deleteProvider() {
    startBusy(async () => {
      await removeProvider(provider.id);
      setConfirmRemove(false);
      onChange();
    });
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{provider.name}</span>
          <Badge variant="outline" className="font-normal capitalize">
            {provider.type}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {provider.type === "ollama" ? provider.baseUrl : provider.apiKeySet ? "API key set" : "No API key"}
          </span>
        </div>
        <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {provider.name}?</DialogTitle>
              <DialogDescription>
                Removes this provider and all its registered models. Any user (or the org default) currently set to
                use one of them falls back to another configured model instead.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="destructive" onClick={deleteProvider} disabled={isBusy}>
                {isBusy ? <Loader2 className="animate-spin" /> : null}
                Remove provider
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {provider.models.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {provider.models.map((model) => (
            <div key={model.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-sm">
              <span className="font-mono text-xs">{model.modelId}</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox checked={model.enabledForUsers} onCheckedChange={(v) => toggleEnabled(model.id, v === true)} disabled={isBusy} />
                  Available to users
                </label>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-destructive hover:text-destructive" onClick={() => deleteModel(model.id)} disabled={isBusy}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={loadModels} disabled={isFetching}>
          {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Fetch available models
        </Button>
        {fetchError && <span className="text-xs text-destructive">{fetchError}</span>}
      </div>

      {fetchedModels !== null && (
        <div className="mt-2">
          {addableModels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {fetchedModels.length === 0 ? "No models found." : "All fetched models are already registered."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {addableModels.map((modelId) => (
                <button
                  key={modelId}
                  type="button"
                  disabled={isBusy}
                  onClick={() => addModel(modelId)}
                  className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-muted-foreground hover:border-solid hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> {modelId}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
