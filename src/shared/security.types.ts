// Security contract (PLAN/04 §3.2): data key state, Access, sessions. Super_admin only.

/** Whether the data key decrypts the stored secrets. */
export type DataKeyState = "ok" | "mismatch";

/** GET /api/dev/security (super_admin). */
export type SecurityStatus = {
  dataKey: {
    state: DataKeyState;
    /** The secret file was created at this boot (fresh install or lost file). */
    createdThisBoot: boolean;
    exportedAt: string | null;
    /** Secret setting keys that cannot be decrypted with the current key. */
    unreadableSettings: string[];
  };
  access: { https: boolean; lastSeenAt: string | null };
  sessions: { active: number; users: number };
  backupsIncludeSecrets: boolean;
};

/** POST /api/dev/users/:id/sessions/revoke and POST /api/dev/sessions/revoke-all. */
export type RevokedSessions = { revoked: number };

/** Body of the data key reset (typed confirmation). */
export type DataKeyResetInput = { confirm: "hapus" };
