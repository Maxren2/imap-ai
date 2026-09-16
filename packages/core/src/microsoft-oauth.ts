export interface MicrosoftOAuthEnv {
  clientId: string;
  clientSecret: string;
  tenant: string;
  refreshToken: string;
}

/**
 * Exchanges a stored refresh token for a short-lived access token usable
 * as the XOAUTH2 credential for Outlook's real IMAP/SMTP endpoints --
 * mirrors gmail-oauth.ts's shape. Deliberately a plain `fetch` against
 * Microsoft's v2 token endpoint rather than pulling in `@azure/msal-node`:
 * gmail-oauth.ts already sets the precedent of a light OAuth client over a
 * heavy SDK, and a refresh-token grant is just one POST.
 *
 * Must have been minted with the offline_access plus
 * https://outlook.office.com/IMAP.AccessAsUser.All scopes -- Graph-only
 * scopes don't work here, same reasoning as Gmail's mail.google.com scope
 * requirement (see gmail-oauth.ts): this project talks to real IMAP, not a
 * provider's REST API, on purpose (DESIGN.md section 2).
 */
export async function getMicrosoftAccessToken(env: MicrosoftOAuthEnv): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${env.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: env.refreshToken,
      grant_type: "refresh_token",
      scope: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
    }),
  });

  if (!response.ok) {
    throw new Error(`Microsoft token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Failed to obtain an access token from the refresh token");
  }
  return data.access_token;
}
