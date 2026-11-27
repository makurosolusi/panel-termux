// Lazy toasts (DECISIONS B30): calls before the Toaster subscribed are queued, then reach sonner in order.
import { expect, spyOn, test } from "bun:test";
import * as sonner from "sonner";
import { toast, toasterReady } from "@/web/shared/toast.lazy";

test("toasts wait for the Toaster, then go to sonner with their arguments", async () => {
  const success = spyOn(sonner.toast, "success");
  const error = spyOn(sonner.toast, "error");
  // Other test files may have queued toasts in this process too: look only at this test's calls.
  const order = (spy: typeof success, text: string) =>
    spy.mock.invocationCallOrder[spy.mock.calls.findIndex((c) => c[0] === text)] ?? -1;
  toast.success("Saved.");
  toast.error("Couldn't save.", { duration: 8000 });
  await Bun.sleep(10);
  expect(order(success, "Saved.")).toBe(-1);
  toasterReady();
  await Bun.sleep(10);
  expect(success).toHaveBeenCalledWith("Saved.");
  expect(error).toHaveBeenCalledWith("Couldn't save.", { duration: 8000 });
  expect(order(success, "Saved.")).toBeLessThan(order(error, "Couldn't save."));
});
