// Plain (non-"use server") constants shared between server and client
// components -- a "use server" file may only export async functions, so
// this can't live alongside the mail-actions.ts server actions that use it.
export const INBOX_PAGE_SIZE = 50;
export const SENDER_PAGE_SIZE = 300;
