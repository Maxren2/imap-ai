import { OAuth2Client } from "google-auth-library";

export interface GmailOAuthEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Exchanges a stored refresh token for a short-lived access token usable
 * as the XOAUTH2 credential for IMAP/SMTP. Must have been minted with the
 * https://mail.google.com/ scope -- the REST-API-only scopes don't work here.
 */
export async function getGmailAccessToken(env: GmailOAuthEnv): Promise<string> {
  const client = new OAuth2Client(env.clientId, env.clientSecret);
  client.setCredentials({ refresh_token: env.refreshToken });

  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("Failed to obtain an access token from the refresh token");
  }
  return token;
}
