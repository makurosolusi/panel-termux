/** Indonesian strings of the public landing page at `/` (merged into `id.landing`). */
export const idLanding = {
  githubUrl: "https://github.com/makurosolusi/panel-termux",
  nav: { label: "Navigasi halaman", features: "Fitur", how: "Cara kerja", faq: "FAQ", github: "GitHub" },
  cta: {
    signIn: "Masuk dengan Google",
    open: "Buka panel",
    secondary: "Lihat cara kerjanya",
  },
  hero: {
    eyebrow: "bun-linux-arm64-android · tanpa root · tanpa Docker",
    titleA: "HP bekas di laci?",
    titleB: "Jadikan",
    titleEm: "server",
    titleC: "yang tak pernah tidur.",
    lead: "panel-termux mengubah HP Android dengan Termux jadi server yang selalu nyala untuk aplikasi web Bun single-binary. Pantau, deploy, backup, dan pasang domain — semuanya dari browser.",
    mockLabel: "Ilustrasi tampilan panel di HP: status perangkat, layanan, dan log deploy",
    mockCaption: "tampilan ilustrasi",
    stamp: "no root",
  },
  specs: {
    label: "Spesifikasi singkat",
    items: [
      { value: "1", unit: "binary", note: "native Android, jalan langsung di Termux" },
      { value: "~110", unit: "MB", note: "ukuran di disk" },
      { value: "~65", unit: "MB RAM", note: "diukur di HP sungguhan" },
      { value: "0", unit: "root", note: "tanpa root, tanpa Docker" },
    ],
  },
  mock: {
    host: "panel · ringkasan",
    battery: "Baterai",
    charging: "mengisi",
    temp: "Suhu",
    tempOk: "normal",
    memory: "Memori",
    disk: "Disk",
    services: "Layanan runit",
    running: "jalan",
    deploy: "deploy toko-kopi",
    upload: "↑ upload 8/8 · sha256 ✓",
    deployOk: "health 200 · selesai",
  },
  why: {
    kicker: "§01 — kenapa HP bekas",
    title: "Server yang sudah kamu punya.",
    items: [
      {
        title: "UPS bawaan",
        body: "Baterainya ikut jadi cadangan daya. Listrik kedip, server tetap jalan.",
      },
      {
        title: "Daya kecil",
        body: "Chip ARM di HP dirancang hemat. Cocok dibiarkan menyala 24 jam di pojok meja.",
      },
      {
        title: "Tanpa IP publik",
        body: "Cloudflare Tunnel membawa domainmu ke HP. Tidak perlu buka port atau atur router.",
      },
      {
        title: "Cukup untuk Bun",
        body: "Satu binary Bun per aplikasi, ditambah PostgreSQL lokal. Ringan dan mandiri.",
      },
    ],
  },
  features: {
    kicker: "§02 — fitur",
    title: "Semua yang biasanya butuh SSH, sekarang tinggal klik.",
    items: [
      {
        title: "Wizard situs",
        body: "Satu alur: folder, database PostgreSQL, .env, entri pm2, rute Cloudflare Tunnel, dan DNS. Satu langkah gagal? Semuanya di-rollback otomatis. Situs lama bisa diadopsi.",
        steps: ["folder", "postgres", ".env", "pm2", "tunnel", "dns"],
      },
      {
        title: "Deploy dari browser",
        body: "Upload binary per potongan dengan checksum. Runtime native atau glibc terdeteksi otomatis, lalu health check. Gagal? Rollback otomatis, atau satu klik ke versi sebelumnya.",
      },
      {
        title: "Pantau perangkat",
        body: "Persen baterai, status charging, suhu, memori, disk, dan load — kondisi HP terlihat sekilas.",
      },
      {
        title: "Layanan & aplikasi",
        body: "Start, stop, restart layanan runit (sshd, postgres, pm2, cloudflared) dan aplikasi pm2, plus log. Layanan inti dilindungi dari stop.",
      },
      {
        title: "Backup off-device",
        body: "pg_dump tiap database dan DB panel, setiap hari ke Cloudflare R2/S3 dengan retensi. Perintah restore siap salin.",
      },
      {
        title: "Akses & audit",
        body: "Login Google, peran user / admin / super_admin, dan konsol /dev: health, pengguna, audit log, log aplikasi, pengaturan terenkripsi.",
      },
    ],
  },
  how: {
    kicker: "§03 — cara kerja",
    title: "Dari laci ke internet dalam empat langkah.",
    steps: [
      {
        title: "Siapkan Termux",
        body: "Pasang Termux beserta termux-services, pm2, cloudflared, dan PostgreSQL.",
        code: "pkg install termux-services",
      },
      {
        title: "Pasang panel",
        body: "Salin binary ke HP dan jalankan script instalasinya. Panel jadi service runit.",
        code: "sh scripts/install-phone.sh ./dist/panel-android-arm64",
      },
      {
        title: "Hubungkan domain",
        body: "Arahkan hostname ke tunnel cloudflared. Panel hanya listen di 127.0.0.1.",
        code: "cloudflared tunnel route dns <tunnel> panel.<domain>",
      },
      {
        title: "Deploy aplikasi",
        body: "Buat situs lewat wizard, lalu upload binary Bun dari browser.",
        code: "bun build --compile --target=bun-linux-arm64-android",
      },
    ],
  },
  arch: {
    kicker: "§04 — arsitektur",
    title: "Koneksi keluar saja. Tidak ada port yang dibuka.",
    lead: "cloudflared di HP membuka tunnel keluar ke Cloudflare. Pengunjung datang lewat domainmu, Cloudflare meneruskannya ke tunnel.",
    label: "Diagram alur: HP Android ke cloudflared ke Cloudflare ke internet",
    nodes: [
      { title: "HP Android", detail: "Termux · panel :3200 · app :3001–3999" },
      { title: "cloudflared", detail: "service runit · tunnel keluar" },
      { title: "Cloudflare", detail: "DNS · Tunnel · Access" },
      { title: "Internet", detail: "https://app.domainmu" },
    ],
  },
  faq: {
    kicker: "§05 — tanya jawab",
    title: "Pertanyaan yang wajar.",
    items: [
      {
        q: "Perlu root?",
        a: "Tidak. Panel adalah satu binary native Android yang jalan langsung di Termux biasa. Tanpa root, tanpa Docker.",
      },
      {
        q: "Bagaimana dengan baterai?",
        a: "Biarkan HP tercolok charger. Panel menampilkan persen baterai, status charging, dan suhu, jadi kamu bisa melihat kalau ada yang tidak beres.",
      },
      {
        q: "Aman dibuka ke internet?",
        a: "Panel hanya listen di 127.0.0.1 dan diakses lewat Cloudflare Tunnel. Akun baru hanya mendapat peran user, nilai rahasia di pengaturan dienkripsi, dan aksi penting tercatat di audit log. Pasang juga Cloudflare Access di depan panel.",
      },
      {
        q: "Aplikasi apa saja yang bisa jalan?",
        a: "Aplikasi web Bun single-binary: target bun-linux-arm64-android jalan native, target bun-linux-arm64 (glibc) jalan lewat grun. Setiap situs bisa punya database PostgreSQL sendiri dan dijalankan pm2.",
      },
      {
        q: "Kalau HP rusak, data saya?",
        a: "Backup harian dikirim ke luar HP (Cloudflare R2/S3): dump setiap database dan DB panel, lengkap dengan perintah restore.",
      },
    ],
  },
  final: {
    title: "Laci kosong, server penuh.",
    body: "Ambil HP lama itu, colok charger, dan mulai hosting aplikasimu sendiri.",
  },
  footer: {
    tagline: "Panel web untuk server HP Android (Termux).",
    source: "Kode sumber di GitHub",
  },
} as const;
