// Lazy toasts (DECISIONS B30): calls before the Toaster subscribed are queued, then reach sonner in order.
import { expect, spyOn, test } from "bun:test";
import * as sonner from "sonner";
import { toast, toasterReady } from "@/web/shared/toast.lazy";

test("toasts wait for the Toaster, then go to sonner with their arguments", async () => {
  const success = spyOn(sonner.toast, "success");
  const error = spyOn(sonner.toast, "error");
  toast.success("Disimpan.");
  toast.error("Gagal.", { duration: 8000 });
  await Bun.sleep(10);
  expect(success).not.toHaveBeenCalled();
  toasterReady();
  await Bun.sleep(10);
  expect(success).toHaveBeenCalledWith("Disimpan.");
  expect(error).toHaveBeenCalledWith("Gagal.", { duration: 8000 });
  expect(success.mock.invocationCallOrder[0]).toBeLessThan(error.mock.invocationCallOrder[0] as number);
});
