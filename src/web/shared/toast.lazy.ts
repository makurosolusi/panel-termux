// Toasts without sonner on the initial path (DECISIONS B30): the library (~10 KB gzip) arrives with the lazily mounted
// Toaster (AppLayout). Calls made before it has subscribed wait for it instead of being dropped.
type Sonner = typeof import("sonner");
type Kind = "success" | "error" | "warning";
type Args = Parameters<Sonner["toast"]["success"]>;

let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

/** Called by the Toaster once it listens; toasts queued until then are shown. */
export const toasterReady = (): void => markReady();

const show =
  (kind: Kind) =>
  (...args: Args): void => {
    void Promise.all([import("sonner"), ready]).then(([m]) => m.toast[kind](...args));
  };

/** sonner's `toast.success/error/warning`, loaded on demand. */
export const toast = { success: show("success"), error: show("error"), warning: show("warning") };
