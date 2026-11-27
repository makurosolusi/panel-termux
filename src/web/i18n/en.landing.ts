import { msg } from "@/shared/i18n";

const REPO = "https://github.com/makurosolusi/panel-termux";

/** UI strings of the public landing page at `/` (imported directly by src/web/landing, also `id.landing`). */
export const tLanding = msg("landing", {
  /** Tab title + link preview; must equal `OG_TEXT` in src/server/http/seo.ts (tests/web.landing.test.ts). */
  meta: {
    title: "Panel Termux — turn an Android phone into a server",
    description:
      "Web panel that turns an Android phone with Termux into a server for single-binary Bun apps: monitoring, deploys, backups and domains via Cloudflare Tunnel.",
    imageAlt:
      "Panel Termux logo and name, the words monitor · deploy · backup · domains, and a screenshot of the Overview on a phone",
  },
  links: {
    github: REPO,
    releases: `${REPO}/releases`,
    license: `${REPO}/blob/main/LICENSE`,
    changelog: `${REPO}/blob/main/CHANGELOG.md`,
    readmeInstall: `${REPO}#install-on-your-phone`,
  },
  nav: {
    label: "Page navigation",
    install: "Install",
    features: "Features",
    how: "How it works",
    faq: "FAQ",
    github: "GitHub",
  },
  cta: {
    install: "Install on your phone",
    github: "View on GitHub",
    signIn: "Sign in",
    open: "Open panel",
    account: "My account",
  },
  hero: {
    eyebrow: "No root · no Docker",
    titleA: "Old phone in a drawer?",
    titleB: "Make it a",
    titleEm: "server",
    titleC: "for your apps.",
    lead: "Panel Termux turns an Android phone running Termux into a server for Bun web apps. Create sites, deploy, monitor and back up from the browser, through Cloudflare Tunnel with no public IP.",
    shotCaption: "Screenshot from demo mode, sample data",
  },
  specs: {
    label: "Quick specs",
    items: [
      { value: "1", unit: "binary", note: "native Android, runs in plain Termux" },
      { value: "~65", unit: "MB RAM", note: "measured on a real phone (v0.2)" },
      { value: "±30", unit: "min", note: "first-time setup, once" },
      { value: "0", unit: "root", note: "no root, no Docker" },
    ],
  },
  install: {
    kicker: "§01 — install",
    title: "Install on your phone.",
    lead: "Setup, honestly: one line in Termux, a few questions, one Cloudflare login, and about half an hour including creating a Google OAuth client. After that the panel runs on its own as a Termux service.",
    prereqTitle: "What you need",
    prereqs: [
      "A 64-bit (arm64) Android phone that can stay on and plugged into a charger.",
      "Termux, Termux:Boot and Termux:API from F-Droid (the same source for all three), not the Play Store.",
      "A domain managed in a Cloudflare account.",
      "A Google Cloud account to create the sign-in OAuth client.",
      "A computer, to create the OAuth client comfortably and to build your apps.",
    ],
    stepsTitle: "Four steps",
    steps: [
      {
        title: "Run this line in Termux",
        body: "It downloads the panel from the latest release and runs panel init. Init shows its plan and asks once before it starts, then installs packages, PostgreSQL, runit services and Termux:Boot.",
      },
      {
        title: "Answer the init questions",
        body: "The panel address (e.g. panel.yourdomain.com), the owner's Google email, then the Client ID and Client secret of your Google OAuth client. Init prints the redirect URI to paste into Google Cloud.",
        code: "panel docs google",
      },
      {
        title: "Sign in to Cloudflare in the browser",
        body: "Init opens the Cloudflare login page; choose your domain. The tunnel, the panel address DNS and the cloudflared service are created for you.",
      },
      {
        title: "Open the panel",
        body: "Init starts the panel, checks it and prints its address. Sign in with that Google email. Then put Cloudflare Access in front of /panel, /dev, /api/panel and /api/dev, and adjust Android battery settings.",
        code: "panel docs android",
      },
    ],
    command:
      "cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/latest/download/panel && chmod +x panel-termux && ./panel-termux init",
    copy: "Copy install line",
    viewReleases: "View releases",
    checksum: "Init checks the binary's SHA-256 against the release SHA256SUMS before installing.",
    readme: "Full guide in the README",
    upgrade: "To upgrade, run the same line. Download interrupted? Run the whole line again.",
  },
  shots: {
    kicker: "§02 — screens",
    title: "Here's what it looks like.",
    label: "Panel screenshot gallery, swipe to see them all",
    items: {
      overview: {
        caption: "Overview on a phone",
        alt: "Overview page on a phone screen: battery, temperature, memory, services and the latest problems",
      },
      sites: {
        caption: "Sites and deploys",
        alt: "Site list with status, domain and deploy progress on a desktop screen",
      },
      health: {
        caption: "System health",
        alt: "System health page on a desktop screen: verdict, backups and checks",
      },
      services: {
        caption: "Services on a phone",
        alt: "List of the sshd, postgres, pm2 and cloudflared services with restart buttons on a phone screen",
      },
    },
  },
  why: {
    kicker: "§03 — why an old phone",
    title: "A server you already own.",
    items: [
      {
        title: "Built-in UPS",
        body: "The phone's battery is your backup power. A short outage and the server keeps running.",
      },
      {
        title: "Low power",
        body: "Phone ARM chips are built to save power, so it can stay on 24 hours a day in a corner of your desk.",
      },
      {
        title: "No public IP",
        body: "Cloudflare Tunnel routes your domain to the phone. No ports to open, no router to configure.",
      },
      {
        title: "Enough for Bun",
        body: "One Bun binary per app and a local PostgreSQL. No containers or extra runtimes needed.",
      },
    ],
  },
  features: {
    kicker: "§04 — features",
    title: "Work you usually do over SSH, now from the browser.",
    items: [
      {
        title: "Site wizard",
        body: "One flow creates the folder, PostgreSQL database, .env, pm2 entry, Cloudflare Tunnel route and DNS. If a step fails, the earlier steps are undone for you. Existing sites can be adopted.",
        steps: ["folder", "postgres", ".env", "pm2", "tunnel", "dns"],
      },
      {
        title: "Deploy from the browser",
        body: "Upload a binary in chunks with a SHA-256 checksum, then the panel checks its health. If it fails, the old version comes back automatically; you can restore the previous version at any time.",
      },
      {
        title: "Monitor the device",
        body: "Battery, charging state, temperature, memory, storage and system load on one screen.",
      },
      {
        title: "Services & apps",
        body: "Start, stop and restart runit services (sshd, postgres, pm2, cloudflared) and pm2 apps, with logs.",
      },
      {
        title: "Off-phone backups",
        body: "Every day, all databases and panel data go to Cloudflare R2 or S3, with adjustable retention. The restore command is ready to copy.",
      },
      {
        title: "Access & audit",
        body: "Google sign-in, three roles (User, Admin, Super Admin), an audit log for important actions, and secrets stored encrypted. Admins have full control of the phone.",
      },
    ],
  },
  how: {
    kicker: "§05 — how it works",
    title: "From the drawer to the internet in four steps.",
    steps: [
      {
        title: "Set up Termux",
        body: "Install Termux, Termux:Boot and Termux:API from F-Droid.",
      },
      {
        title: "Install the panel from a GitHub release",
        body: "One line downloads the panel; panel init installs packages, PostgreSQL and runit services.",
        code: "./panel-termux init",
      },
      {
        title: "Connect a domain",
        body: "Init creates a Cloudflare Tunnel and DNS for the panel address. The panel only listens on 127.0.0.1.",
        code: "panel doctor",
      },
      {
        title: "Deploy an app",
        body: "Create a site with the wizard, then upload a Bun binary from the browser.",
        code: "bun build --compile --target=bun-linux-arm64-android",
      },
    ],
  },
  arch: {
    kicker: "§06 — architecture",
    title: "Outbound connections only. No open ports.",
    lead: "cloudflared on the phone opens an outbound tunnel to Cloudflare. Visitors come in through your domain and Cloudflare forwards them to the tunnel.",
    label: "Flow diagram: Android phone to cloudflared to Cloudflare to the internet",
    nodes: [
      { title: "Android phone", detail: "Termux · panel :3200 · apps :3001–3999" },
      { title: "cloudflared", detail: "runit service · outbound tunnel" },
      { title: "Cloudflare", detail: "DNS · Tunnel · Access" },
      { title: "Internet", detail: "https://app.yourdomain" },
    ],
  },
  limits: {
    kicker: "§07 — limitations",
    title: "What to know before you install.",
    items: [
      {
        title: "No per-process CPU%",
        body: "Android blocks /proc/stat, so the panel cannot show CPU usage per process.",
      },
      {
        title: "Domains drop briefly",
        body: "Every domain change restarts cloudflared, so all domains on the tunnel drop for a few seconds.",
      },
      {
        title: "Can't report its own outage",
        body: "If the panel or the phone is down, the panel cannot tell you. Use an external monitor for that.",
      },
      {
        title: "Battery optimization",
        body: "Android can stop Termux when battery optimization is on. Turn it off for Termux.",
      },
      {
        title: "No root, no Docker",
        body: "Apps must be Bun binaries (or processes pm2 can run). Containers are not supported.",
      },
      {
        title: "Admin = full control",
        body: "Admins can run, delete and replace anything on the phone. Give this role only to people you trust.",
      },
      {
        title: "Sign-in is open to Google accounts",
        body: "Anyone can sign in as a User with no access. Cloudflare Access in front of the panel is practically required.",
      },
      {
        title: "Backups need R2 or S3",
        body: "Without an R2/S3 bucket there are no off-phone backups. Calls to R2 and the Cloudflare API have not been tested end to end with real accounts.",
      },
    ],
  },
  faq: {
    kicker: "§08 — FAQ",
    title: "Fair questions.",
    items: [
      {
        q: "Do I need root?",
        a: "No. Panel Termux is a single native Android binary that runs in plain Termux, with no root and no Docker.",
      },
      {
        q: "Is it safe to expose to the internet?",
        a: "The panel only listens on 127.0.0.1 and is reached through Cloudflare Tunnel. New accounts get only the User role with no access, secrets are encrypted, and important actions are recorded in the audit log. Put Cloudflare Access in front of the panel pages and API: without it, the sign-in page is open to anyone.",
      },
      { q: "Is it free?", a: "Yes, it's open source under the MIT license." },
      {
        q: "Do I need a computer?",
        a: "Not to install the panel; you need one to create the Google OAuth client and to build your apps.",
      },
      {
        q: "Is my data sent to you?",
        a: "There is no telemetry. The panel only contacts the services you configure (Cloudflare, the backup bucket, Telegram) and one Google address to check the phone's internet connection.",
      },
      {
        q: "Which apps can run?",
        a: "Bun web apps compiled into a single binary. The bun-linux-arm64-android target runs directly; the bun-linux-arm64 (glibc) target runs through grun. Each site can have its own PostgreSQL database and is run by pm2.",
      },
      {
        q: "What about the battery?",
        a: "Keep the phone plugged into a charger. The panel shows battery percentage, charging state and temperature, so you know quickly when something is off.",
      },
    ],
  },
  final: {
    title: "Empty drawer, server on.",
    body: "Take that old phone, plug it into a charger and run your own apps.",
  },
  accountDeleted: {
    title: "Your account has been deleted.",
    body: "All your sessions have ended. You can sign in again any time as a new User.",
    close: "Close notice",
  },
  footer: {
    tagline: "A web panel that turns an Android phone (Termux) into a server.",
    label: "Project links",
    github: "GitHub",
    license: "MIT license",
    changelog: "Changelog",
    releases: "Releases",
  },
} as const);
