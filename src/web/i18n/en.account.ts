import { msg } from "@/shared/i18n";

/**
 * Message per Better Auth 1.7.28 OAuth callback `?error=` code (PLAN/05 F10). Codes not listed fall back to
 * `signIn.errors.generic`; `error_description` is never rendered because a third party controls it.
 */
const SIGN_IN_ERROR_BY_CODE = {
  access_denied: "cancelled",
  state_mismatch: "state",
  state_not_found: "state",
  email_not_found: "email",
  email_not_verified: "email",
} as const;

/** UI strings of /login, /profile and the public 404 (English source; overlay `id.account`, PLAN/05 §5.6–5.7, PLAN/08). */
export const tAccount = msg("account", {
  signIn: {
    title: "Sign in to Panel Termux",
    subtitle: "Use your Google account. New accounts start as User until a Super Admin changes their role.",
    google: "Sign in with Google",
    redirecting: "Redirecting to Google…",
    back: "Back to home",
    hostLabel: "Panel address",
    own: "This panel belongs to its owner. Want your own?",
    ownLink: "Install Panel Termux",
    errors: {
      generic:
        "Signing in with Google didn't work. Try again; if it keeps failing, make sure you're using the right Google account.",
      start: "Couldn't open the Google sign-in page. Check your internet connection, then try again.",
      cancelled: "Sign-in was cancelled. Choose a Google account to continue.",
      state: "The sign-in session expired or cookies are blocked. Open this page again, then try once more.",
      email: "Google didn't share a verified email for this account. Use another Google account, then try again.",
    },
  },
  profile: {
    title: "Profile",
    account: "Account",
    role: "Role",
    email: "Email",
    memberSince: "Joined",
    signOut: "Sign out",
  },
  sessions: {
    title: "Active sessions",
    description: "Devices that are signed in to your account.",
    current: "This device",
    device: "Device",
    ip: "IP address",
    lastActive: "Last active",
    ipHidden: "IP not recorded",
    currentHint: "Sign out from the Account card.",
    unknownDevice: "Unknown device",
    activeToday: "Active today",
    activeYesterday: "Active yesterday",
    activeOn: (date: string) => `Active ${date}`,
    revoke: "Sign out",
    revokeTitle: (device: string) => `Sign out ${device}?`,
    revokeBody: "That device will have to sign in with Google again.",
    revoked: "Device signed out.",
    revokeOthers: "Sign out of all other devices",
    revokeOthersTitle: "Sign out of all other devices?",
    revokeOthersBody: "Every device except this one will have to sign in with Google again.",
    revokedOthers: (n: number) => (n === 1 ? "1 other session signed out." : `${n} other sessions signed out.`),
    gone: "That session had already ended. The list was refreshed.",
    empty: "Only this device is signed in.",
  },
  noAccess: {
    title: "Your account doesn't have access to this panel yet",
    body: "This Panel Termux belongs to its owner. If you're on the team, send your account email to the owner and ask for the Admin role. Once your role is changed, reload this page.",
    steps: [
      "Copy the email address below.",
      "Send it to the panel owner and ask for the Admin role.",
      "Once the owner has changed your role, press Reload.",
    ],
    emailLabel: "Your account email",
    reload: "Reload",
    ownServerHref: "/#install",
    ownServer: "Want your own server? Install Panel Termux on your phone",
  },
  theme: {
    title: "Theme",
    description: "Applies to this browser only. System follows your device's light or dark setting.",
    light: "Light",
    dark: "Dark",
    system: "System",
  },
  language: {
    title: "Language",
    description: "Saved to your account, so your other devices use it too. The page reloads to apply it.",
    device: "Use device language",
  },
  deleteAccount: {
    title: "Delete my account",
    body: "Your account, sessions and profile are removed from this panel. The activity log (audit) keeps the name and email you used until its retention period ends (365 days by default), then they are deleted automatically. You can sign in again at any time as a new User.",
    dialogTitle: "Delete my account?",
    button: "Delete my account",
    codes: {
      confirm_mismatch: "The email you typed doesn't match your account email. Type it exactly as shown.",
      forbidden: "Only accounts with the User role can delete themselves.",
    },
  },
  publicNotFound: {
    title: "Page not found",
    body: "This address doesn't exist on Panel Termux.",
    home: "Go to home",
    signIn: "Sign in",
    documentTitle: "Page not found · Panel Termux",
  },
} as const);

/** Sign-in error message for an OAuth `?error=` code; null when there is none. */
export function signInErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const known = Object.hasOwn(SIGN_IN_ERROR_BY_CODE, code);
  return tAccount.signIn.errors[known ? SIGN_IN_ERROR_BY_CODE[code as keyof typeof SIGN_IN_ERROR_BY_CODE] : "generic"];
}
