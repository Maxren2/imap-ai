"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X } from "lucide-react";
import {
  updateGoogleOAuth,
  clearGoogleSecret,
  updateMicrosoftOAuth,
  clearMicrosoftSecret,
  type OAuthStatus,
} from "./actions";

export function OAuthSettingsForm({ initial }: { initial: OAuthStatus }) {
  const [googleClientId, setGoogleClientId] = useState(initial.googleClientId);
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [microsoftClientId, setMicrosoftClientId] = useState(initial.microsoftClientId);
  const [microsoftClientSecret, setMicrosoftClientSecret] = useState("");
  const [microsoftTenant, setMicrosoftTenant] = useState(initial.microsoftTenant);

  const [isSavingGoogle, startSaveGoogle] = useTransition();
  const [isSavingMicrosoft, startSaveMicrosoft] = useTransition();
  const [googleSecretSet, setGoogleSecretSet] = useState(initial.googleClientSecretSet);
  const [microsoftSecretSet, setMicrosoftSecretSet] = useState(initial.microsoftClientSecretSet);
  const [savedGoogle, setSavedGoogle] = useState(false);
  const [savedMicrosoft, setSavedMicrosoft] = useState(false);

  function saveGoogle() {
    setSavedGoogle(false);
    startSaveGoogle(async () => {
      await updateGoogleOAuth(googleClientId, googleClientSecret);
      if (googleClientSecret) setGoogleSecretSet(true);
      setGoogleClientSecret("");
      setSavedGoogle(true);
    });
  }

  function removeGoogleSecret() {
    startSaveGoogle(async () => {
      await clearGoogleSecret();
      setGoogleSecretSet(false);
      setSavedGoogle(true);
    });
  }

  function saveMicrosoft() {
    setSavedMicrosoft(false);
    startSaveMicrosoft(async () => {
      await updateMicrosoftOAuth(microsoftClientId, microsoftClientSecret, microsoftTenant);
      if (microsoftClientSecret) setMicrosoftSecretSet(true);
      setMicrosoftClientSecret("");
      setSavedMicrosoft(true);
    });
  }

  function removeMicrosoftSecret() {
    startSaveMicrosoft(async () => {
      await clearMicrosoftSecret();
      setMicrosoftSecretSet(false);
      setSavedMicrosoft(true);
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Google OAuth</h3>
        <p className="text-xs text-muted-foreground">
          Used for both "Connect Gmail" and "Connect Google Calendar". Overrides GOOGLE_CLIENT_ID/SECRET when set here
          -- takes effect immediately, no restart needed.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Client ID</label>
            <Input
              className="mt-1"
              value={googleClientId}
              onChange={(e) => {
                setGoogleClientId(e.target.value);
                setSavedGoogle(false);
              }}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Client secret {googleSecretSet && <Badge variant="outline" className="ml-1 font-normal">set</Badge>}
            </label>
            <Input
              type="password"
              className="mt-1"
              placeholder={googleSecretSet ? "Leave blank to keep current" : "Not set"}
              value={googleClientSecret}
              onChange={(e) => {
                setGoogleClientSecret(e.target.value);
                setSavedGoogle(false);
              }}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" disabled={isSavingGoogle} onClick={saveGoogle}>
            {isSavingGoogle ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
          {googleSecretSet && (
            <Button type="button" size="sm" variant="ghost" disabled={isSavingGoogle} onClick={removeGoogleSecret}>
              <X className="h-3.5 w-3.5" /> Remove secret
            </Button>
          )}
          {savedGoogle && !isSavingGoogle && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-semibold">Microsoft OAuth</h3>
        <p className="text-xs text-muted-foreground">
          Used for both "Connect Outlook" and "Connect Outlook Calendar". Overrides MICROSOFT_CLIENT_ID/SECRET/TENANT
          when set here -- takes effect immediately, no restart needed.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Client ID</label>
            <Input
              className="mt-1"
              value={microsoftClientId}
              onChange={(e) => {
                setMicrosoftClientId(e.target.value);
                setSavedMicrosoft(false);
              }}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Client secret {microsoftSecretSet && <Badge variant="outline" className="ml-1 font-normal">set</Badge>}
            </label>
            <Input
              type="password"
              className="mt-1"
              placeholder={microsoftSecretSet ? "Leave blank to keep current" : "Not set"}
              value={microsoftClientSecret}
              onChange={(e) => {
                setMicrosoftClientSecret(e.target.value);
                setSavedMicrosoft(false);
              }}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tenant</label>
            <Input
              className="mt-1"
              placeholder="common"
              value={microsoftTenant}
              onChange={(e) => {
                setMicrosoftTenant(e.target.value);
                setSavedMicrosoft(false);
              }}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" disabled={isSavingMicrosoft} onClick={saveMicrosoft}>
            {isSavingMicrosoft ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
          {microsoftSecretSet && (
            <Button type="button" size="sm" variant="ghost" disabled={isSavingMicrosoft} onClick={removeMicrosoftSecret}>
              <X className="h-3.5 w-3.5" /> Remove secret
            </Button>
          )}
          {savedMicrosoft && !isSavingMicrosoft && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
