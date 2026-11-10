import { z } from "zod";

export const SUPPORT_EMAIL = "support@walletor.com";
export const SUPPORT_EMAIL_LINK =
  "mailto:support@walletor.com?subject=Walletor%20support";
export const SUPPORT_DISCLAIMER =
  "Walletor support will never ask you to send money or share your seed phrase, private key, password or verification codes. Never share these in this chat or by email.";
export const SupportMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(3000),
  })
  .strict();
export const SupportChatInputSchema = z
  .object({
    question: z.string().trim().min(1).max(600),
    history: z.array(SupportMessageSchema).max(6).default([]),
  })
  .strict();
export const SupportChatResponseSchema = z.object({
  answer: z.string().min(1).max(3000),
});
export type SupportMessage = z.infer<typeof SupportMessageSchema>;
