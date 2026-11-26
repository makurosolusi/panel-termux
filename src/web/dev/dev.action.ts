import { toast } from "sonner";
import { devErrorMessage } from "./dev.api";

/** Runs a mutation, toasting `success` or the mapped error message; resolves to whether it succeeded. */
export async function runDevAction(mutation: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await mutation();
    toast.success(success);
    return true;
  } catch (err) {
    toast.error(devErrorMessage(err)); // surfaced to the user; 401/403 already redirected inside devFetch
    return false;
  }
}
