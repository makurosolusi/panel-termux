import type { BackupVerifyCode } from "@/shared/backup.types";
import type { CloudflareVerifyCode, SettingKey } from "@/shared/dev.types";
import { msg } from "@/shared/i18n";
import type { AlertErrorCode } from "@/shared/monitor.types";
import type { SettingGroup } from "@/web/dev/settings.registry";

/** Copy of one setting field. `invalid` = shown when PATCH answers `invalid` for this key. */
export type SettingFieldCopy = { label: string; help: string; placeholder?: string; invalid: string };

/** Copy of one settings card on /dev/settings. */
export type SettingGroupCopy = { title: string; description: string };

/** UI strings of /dev/settings (PLAN/05 §5.2 + §5.5; Indonesian overlay in `id.settings`). Every SettingKey must have a field. */
export const tSettings = msg("settings", {
  title: "Settings",
  subtitle: "Secret values are stored encrypted and never shown again.",
  groups: {
    cloudflare: {
      title: "Cloudflare",
      description: "Token used to create DNS records automatically when you add a domain to a site.",
    },
    backup: {
      title: "Backup",
      description: "R2 or S3 storage for the daily backup, its schedule, and how long backups are kept.",
    },
    alerts: {
      title: "Telegram alerts",
      description: "Send a Telegram message when a service, app, site, or the phone has a problem.",
    },
    sites: {
      title: "Sites",
      description: "Folder and port range used when creating a new site.",
    },
    monitor: {
      title: "Monitoring",
      description: "How often the panel checks the phone and when the battery needs attention.",
    },
    security: {
      title: "Security",
      description: "Services protected from accidental stops, and how long the audit log is kept.",
    },
  } satisfies Record<SettingGroup, SettingGroupCopy>,
  fields: {
    "cloudflare.api_token": {
      label: "Cloudflare API token",
      help: "A token with Zone:Read and DNS:Edit permissions for your sites' zones.",
      placeholder: "Paste a new token",
      invalid: "A token is 20–200 letters, digits, `_` or `-`.",
    },
    "cloudflare.account_id": {
      label: "Cloudflare account ID",
      help: "Shown in the Cloudflare dashboard, in the right column of the account overview page.",
      placeholder: "e.g. 0123456789abcdef0123456789abcdef",
      invalid: "An account ID is 32 hexadecimal characters.",
    },
    "backup.s3_endpoint": {
      label: "S3 endpoint",
      help: "Address of the storage service. For R2: https://<account ID>.r2.cloudflarestorage.com.",
      placeholder: "e.g. https://<account>.r2.cloudflarestorage.com",
      invalid: "Enter an http(s) URL with no path, query, or user name.",
    },
    "backup.s3_bucket": {
      label: "Bucket name",
      help: "Bucket that receives the backups. Create it first in your storage provider's dashboard.",
      placeholder: "e.g. panel-backups",
      invalid: "A bucket name is 3–63 lowercase letters, digits, dots, or `-`.",
    },
    "backup.s3_access_key_id": {
      label: "Access key ID",
      help: "First part of the storage API key. Stored encrypted.",
      placeholder: "Paste the access key ID",
      invalid: "A key is 8–256 letters, digits, or `+ / = _ -`.",
    },
    "backup.s3_secret_access_key": {
      label: "Secret access key",
      help: "Secret part of the storage API key. Stored encrypted and never shown again.",
      placeholder: "Paste the secret access key",
      invalid: "A key is 8–256 letters, digits, or `+ / = _ -`.",
    },
    "backup.s3_region": {
      label: "Region",
      help: "Leave `auto` for R2. Other S3 providers usually show the region in their dashboard.",
      placeholder: "auto",
      invalid: "A region is 1–32 lowercase letters, digits, or `-`.",
    },
    "backup.prefix": {
      label: "Folder prefix",
      help: "Folder inside the bucket where backups go. Use a different prefix for each phone that shares a bucket.",
      placeholder: "panel-termux/",
      invalid: "Enter a relative prefix of letters, digits, `. _ - /`, ending in `/`, with no `//` or `..`.",
    },
    "backup.hour": {
      label: "Daily backup time",
      help: "Hour (phone time) the automatic backup runs. Choose Off to back up manually only.",
      invalid: "Choose an hour from 00:00 to 23:00, or Off.",
    },
    "backup.retention_days": {
      label: "Keep backups (days)",
      help: "Backups older than this are deleted after a run that did not fail. The last three successful backups and the last valid copy of each item are always kept.",
      placeholder: "14",
      invalid: "Enter a number from 1 to 365.",
    },
    "backup.keep_min_runs": {
      label: "Minimum successful backups",
      help: "How many of the newest successful backups retention never deletes, whatever their age.",
      placeholder: "3",
      invalid: "Enter a number from 1 to 50.",
    },
    "backup.max_item_mb": {
      label: "Size limit per file (MB)",
      help: "Backup files larger than this are not uploaded and are flagged in the backup history.",
      placeholder: "2048",
      invalid: "Enter a number from 1 to 65536.",
    },
    "backup.include_secrets": {
      label: "Include secret keys",
      help: "The data key, the panel `.env`, and tunnel credentials are stored in the bucket too. Anyone who can read the bucket can take over this panel.",
      invalid: "Choose on or off.",
    },
    "alerts.enabled": {
      label: "Telegram alerts",
      help: "Pause alerts without removing the token.",
      invalid: "Choose on or off.",
    },
    "alerts.telegram_bot_token": {
      label: "Telegram bot token",
      help: "Token from @BotFather. Stored encrypted and never shown again.",
      placeholder: "Paste the token from @BotFather",
      invalid: "A token looks like `123456:ABC…` and comes from @BotFather.",
    },
    "alerts.telegram_chat_id": {
      label: "Telegram chat ID",
      help: 'Chat, group, or channel to send to. Use "Find chats" after sending a new message to the bot.',
      placeholder: "e.g. -1001234567890",
      invalid: "Enter a numeric ID (e.g. `-1001234567890`) or `@channelname`.",
    },
    "alerts.language": {
      label: "Telegram language",
      help: "Language of the alerts and test messages sent to Telegram.",
      invalid: "Choose English or Bahasa Indonesia.",
    },
    "alerts.min_severity": {
      label: "Send from",
      help: "Warning = every problem (warnings arrive silently). Critical = critical problems only.",
      invalid: "Choose Warning or Critical.",
    },
    "sites.dir": {
      label: "Sites folder",
      help: "Folder where new sites are created. Existing sites are not moved when you change it.",
      placeholder: "~/sites",
      invalid: "Enter an absolute path or a path starting with `~/`.",
    },
    "sites.port_range": {
      label: "Site port range",
      help: "Ports for new site apps are picked from this range. Write `start-end`, e.g. `3001-3999`.",
      placeholder: "From 3001 to 3999",
      invalid: "The start port must be above 1024 and lower than the end port (max 65535).",
    },
    "monitor.sample_interval_sec": {
      label: "Check interval (seconds)",
      help: "How often the panel checks the phone. Lower finds problems sooner and uses more battery.",
      placeholder: "60",
      invalid: "Enter a number from 30 to 600.",
    },
    "monitor.battery_warn_percent": {
      label: "Battery warning below (%)",
      help: "Warn when the phone is not charging and the battery is below this. Below 15% is always critical. Unplugging the charger yourself is not a problem.",
      placeholder: "25",
      invalid: "Enter a number from 16 to 100, or Off.",
    },
    "panel.protected_services": {
      label: "Core services",
      help: "Services that can only be stopped by typing their name. `panel` and `cloudflared` can never be stopped from the panel, even if removed from this list.",
      invalid: "Enter service names separated by commas, using only letters, digits, `. _ -`.",
    },
    "audit.retention_days": {
      label: "Keep audit log (days)",
      help: "Audit entries older than this are deleted automatically.",
      placeholder: "365",
      invalid: "Enter a number from 90 to 3650.",
    },
  } satisfies Record<SettingKey, SettingFieldCopy>,
  /** Labels of choice/switch controls. */
  options: {
    on: "On",
    off: "Off",
    severity: { warning: "Warning", danger: "Critical" },
    hour: (h: number) => `${String(h).padStart(2, "0")}:00`,
  },
  helpLink: "How to create one",
  required: "Required",
  empty: "This field is required.",
  defaultIs: (v: string) => `Default: ${v}`,
  dirty: "Unsaved changes",
  saved: (group: string) => `${group} settings saved.`,
  saveFailed:
    "Settings were not saved. Check your internet connection and try again. Your changes are still in the form.",
  leaveWarning: "You have unsaved changes. Leave this page?",
  secret: {
    stored: (ago: string) => `Stored · changed ${ago}`,
    storedNoDate: "Stored",
    unreadable: "Unreadable",
    unreadableBody: "The data key changed. Enter the value again.",
    replace: "Replace",
    remove: "Remove",
    cancel: "Cancel",
    show: "Show",
    removeTitle: (label: string) => `Remove ${label}?`,
    removeCloudflare: "New site domains will no longer get DNS records automatically.",
    removeGeneric: "Features that use this value stop working until you enter it again.",
    removeConfirm: "Remove value",
  },
  confirm: {
    includeSecretsTitle: "Include secret keys in backups?",
    includeSecretsBody:
      "The data key, the panel `.env`, and tunnel credentials will be stored in the bucket too. Anyone who can read the bucket can take over this panel. Restrict access to the bucket before turning this on.",
    includeSecretsButton: "Turn on",
    sitesDirTitle: "Change the sites folder?",
    sitesDirBody: "Existing sites stay in the old folder and are not moved.",
    sitesDirButton: "Change folder",
  },
  test: {
    running: "Testing…",
    cloudflareButton: "Test token",
    s3Button: "Test connection",
    telegramButton: "Send test message",
    findChats: "Find chats",
    cloudflare: {
      ok: "The token is active and can access Cloudflare zones.",
      not_set: "No token yet.",
      inactive: "The token is not active. Create a new token in the Cloudflare dashboard.",
      no_zones: "The token is active but cannot see any zones. Add the Zone:Read permission.",
      api_error: "Cloudflare rejected the request. Check the token and account ID.",
      key_mismatch: "The stored value cannot be read because the data key changed. Enter it again.",
    } satisfies Record<CloudflareVerifyCode, string>,
    cloudflareZones: (n: number) => `The token is active and can access ${n} ${n === 1 ? "zone" : "zones"}.`,
    s3: {
      ok: "Connected: the panel can write, read, and delete in the bucket.",
      not_configured: "Fill in the required Backup fields first.",
      unreadable: "The stored value cannot be read because the data key changed. Enter it again.",
      unreachable: "Cannot reach the endpoint. Check the endpoint address and the phone's internet connection.",
      bucket_not_found: "Bucket not found. Check the bucket name.",
      write_denied: "The key is not allowed to write to the bucket.",
      read_failed: "The test object was written but could not be read back.",
      delete_denied: "Writing works but deleting does not, so backup retention will not run.",
      timeout: "The bucket did not answer within 15 seconds. Check the endpoint and try again.",
      s3_error: "S3 rejected the request. See the details below.",
    } satisfies Record<BackupVerifyCode, string>,
    s3Ms: (ms: number) => `${ms} ms`,
    telegramSent: "Test message sent to Telegram.",
    telegram: {
      alerts_not_configured: "Enter and save the bot token and chat ID first.",
      alerts_token_missing: "Enter and save the bot token first.",
      too_soon: "Wait a few seconds and try again.",
      telegram_token_invalid: "Telegram rejected the bot token. Check it and save again.",
      telegram_chat_not_found: 'Chat not found. Send a message to the bot first, then use "Find chats".',
      telegram_chat_migrated: "This group became a supergroup. The new chat ID is saved; send the test message again.",
      telegram_forbidden: "The bot is blocked or not in the group. Unblock it or add it to the group.",
      telegram_conflict: "This bot uses a webhook, so its chats cannot be listed. Enter the chat ID manually.",
      telegram_rate_limited: "Telegram is limiting messages. Try again later.",
      telegram_bad_request: "Telegram rejected the message. Check the chat ID.",
      telegram_unreachable: "The phone cannot reach Telegram. Check the phone's internet connection.",
      telegram_webhook_set: "This bot uses a webhook, so its chats cannot be listed. Enter the chat ID manually.",
    } satisfies Record<
      AlertErrorCode | "alerts_not_configured" | "alerts_token_missing" | "too_soon" | "telegram_webhook_set",
      string
    >,
    noChats: "No chats yet. Send a new message to the bot in Telegram, then search again.",
    chatsTitle: "Chats the bot can see",
    useChat: "Use",
    chatType: { private: "Private", group: "Group", supergroup: "Supergroup", channel: "Channel" },
    chatPicked: "Chat ID filled in. Save to use it.",
    steps: { write: "Write", read: "Read", delete: "Delete" },
    stepState: { ok: "passed", failed: "failed", skipped: "skipped" },
    detail: "Technical details",
    savedValues: "Testing the saved values.",
    draftValues: "Testing the unsaved values in the form.",
  },
  status: {
    default: "Default",
    notSet: "Not set",
    changed: (ago: string) => `Changed ${ago}`,
    changedNoDate: "Changed",
  },
  save: "Save",
  saving: "Saving…",
  reset: "Reset to default",
  incomplete: "Incomplete",
  unknownKey: "The server does not know this setting. Reload the page.",
  emptyPage: "There are no settings to change yet. Reload the page, or check the panel version.",
  toc: "Settings sections",
  removed: (label: string) => `${label} removed.`,
  fieldErrors: "Some values are not valid yet. Check the marked fields and save again.",
  reauth:
    "Changing the backup destination or backing up secret keys requires signing in again (session older than 15 minutes). Unsaved changes will be lost, so enter them again after signing in.",
  keyMismatch: {
    body: "Settings were not saved because the panel's data key does not match the stored secret values. Fix the data key first, then save again.",
    link: "Open Data key",
  },
  /** PATCH / test errors that are not a field problem. */
  errorCodes: {
    invalid_value: "Some values are not valid yet. Check the marked fields and save again.",
    invalid_body: "The request to the server was incomplete. Reload the page and try again.",
    key_mismatch: "The stored value cannot be read because the data key changed. Enter it again.",
    reauth_required: "This change requires signing in again (session older than 15 minutes).",
  },
} as const);
