import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { getGmailAccessToken } from "./gmail-oauth.js";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function connectImap(
  gmailAddress: string,
  extraOptions: Partial<ImapFlowOptions> = {},
): Promise<ImapFlow> {
  const accessToken = await getGmailAccessToken({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refreshToken: requireEnv("GOOGLE_REFRESH_TOKEN"),
  });

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: gmailAddress, accessToken },
    logger: false,
    ...extraOptions,
  });

  await client.connect();
  return client;
}
