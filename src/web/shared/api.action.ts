import { toast } from "sonner";
import { apiErrorMessage, type ErrorCodes } from "./api.client";

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
    toast.error(apiErrorMessage(err, codes)); // surfaced to the user; 401/403 already redirected inside devFetch
    return false;
  }
}
