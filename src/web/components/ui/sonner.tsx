import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { tLayout } from "@/web/i18n/en.layout";
import { toasterReady } from "@/web/shared/toast.lazy";
import { useTheme } from "@/web/theme/theme.store";

/** Phones: stack toasts above the bottom nav and the ActionBar (heights come from styles.css). */
const MOBILE_OFFSET = {
  bottom: "calc(var(--bottom-nav-h, 0px) + var(--action-bar-h, 0px) + 0.75rem + env(safe-area-inset-bottom))",
};

/** The app's single toast region (mounted lazily by AppLayout, see toast.lazy.ts): bottom-right, max 3, closable, icons coloured by tone tokens. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme(); // app theme store (web/theme), so no next-themes provider
  useEffect(toasterReady, []); // runs after Sonner's own effect subscribed, so queued toasts are not lost
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      mobileOffset={MOBILE_OFFSET}
      visibleToasts={3}
      closeButton
      containerAriaLabel={tLayout.toaster.region}
      toastOptions={{
        closeButtonAriaLabel: tLayout.toaster.close,
        classNames: {
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-danger",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-info",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 motion-safe:animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
