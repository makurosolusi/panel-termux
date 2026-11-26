import { createElement } from "react";
import { toast } from "sonner";
import { CodeText } from "@/web/components/code-text";
import { apiErrorMessage, type ErrorCodes } from "./api.client";

/** Error toasts stay long enough to read (PLAN/01 D10); success toasts keep sonner's default. */
export const ERROR_TOAST_MS = 8_000;

/** Runs a mutation, toasting `success` or the error message (section `codes` first); resolves to whether it succeeded. */
export async function runApiAction(
  mutation: () => Promise<unknown>,
  success: string,
  codes?: ErrorCodes,
): Promise<boolean> {
  try {
    await mutation();
    toast.success(success);
    return true;
  } catch (err) {
    // 401/403 already redirected in apiFetch; `code` spans in the message render as <code>
    toast.error(createElement(CodeText, null, apiErrorMessage(err, codes)), { duration: ERROR_TOAST_MS });
    return false;
  }
}
