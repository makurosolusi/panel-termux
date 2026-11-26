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
    titleC: "yang menyala 24 jam.",
    lead: "Panel Termux mengubah HP Android dengan Termux jadi server untuk aplikasi web Bun. Buat situs, deploy, pantau, dan cadangkan dari browser. Tanpa root, tanpa Docker, tanpa IP publik.",
    mockLabel: "Ilustrasi tampilan panel di HP: status perangkat, layanan, dan log deploy",
    mockCaption: "tampilan ilustrasi",
    stamp: "tanpa root",
  },
  specs: {
    label: "Spesifikasi singkat",
    items: [
      { value: "1", unit: "binary", note: "native Android, langsung jalan di Termux" },
      { value: "~110", unit: "MB", note: "ukuran file binary" },
      { value: "~65", unit: "MB RAM", note: "terukur di HP sungguhan" },
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
    services: "Layanan",
    running: "berjalan",
    deploy: "deploy toko-kopi",
    upload: "↑ unggah 8/8 · sha256 ✓",
    deployOk: "health 200 · selesai",
  },
  why: {
    kicker: "§01 — kenapa HP lama",
    title: "Server yang sudah kamu punya.",
    items: [
      {
        title: "UPS bawaan",
        body: "Baterai HP jadi cadangan daya. Listrik padam sebentar, server tetap berjalan.",
      },
      {
        title: "Daya kecil",
        body: "Chip ARM di HP dirancang hemat daya, cocok dibiarkan menyala 24 jam di pojok meja.",
      },
      {
        title: "Tanpa IP publik",
        body: "Cloudflare Tunnel mengarahkan domainmu ke HP. Tidak perlu membuka port atau mengatur router.",
      },
      {
        title: "Cukup untuk Bun",
        body: "Satu binary Bun per aplikasi dan PostgreSQL lokal. Tidak butuh container atau runtime tambahan.",
      },
    ],
  },
  features: {
    kicker: "§02 — fitur",
    title: "Pekerjaan yang biasanya lewat SSH, kini dari browser.",
    items: [
      {
        title: "Wizard situs",
        body: "Satu alur membuat folder, database PostgreSQL, .env, entri pm2, rute Cloudflare Tunnel, dan DNS. Bila satu langkah gagal, langkah sebelumnya dikembalikan otomatis. Situs lama bisa diadopsi.",
        steps: ["folder", "postgres", ".env", "pm2", "tunnel", "dns"],
      },
      {
        title: "Deploy dari browser",
        body: "Unggah binary per potongan dengan checksum SHA-256. Binary native atau glibc terdeteksi otomatis, lalu dicek kesehatannya. Bila gagal, versi lama kembali otomatis; rollback manual cukup satu klik.",
      },
      {
        title: "Pantau perangkat",
        body: "Baterai, status pengisian, suhu, memori, penyimpanan, dan beban CPU dalam satu layar.",
      },
      {
        title: "Layanan & aplikasi",
        body: "Mulai, hentikan, dan mulai ulang layanan runit (sshd, postgres, pm2, cloudflared) serta aplikasi pm2, lengkap dengan log. Layanan inti tidak bisa dihentikan tanpa sengaja.",
      },
      {
        title: "Cadangan di luar HP",
        body: "Setiap hari, semua database dan data panel di-dump ke Cloudflare R2 atau S3, dengan masa simpan yang bisa diatur. Perintah pemulihan tinggal disalin.",
      },
      {
        title: "Akses & audit",
        body: "Masuk dengan Google, tiga peran (Pengguna, Admin, Super Admin), log audit untuk aksi penting, dan pengaturan rahasia yang tersimpan terenkripsi.",
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
        body: "Salin binary ke HP dan jalankan script instalasinya. Panel berjalan sebagai layanan runit.",
        code: "sh scripts/install-phone.sh ./dist/panel-android-arm64",
      },
      {
        title: "Hubungkan domain",
        body: "Arahkan domain ke tunnel cloudflared. Panel hanya mendengarkan di 127.0.0.1.",
        code: "cloudflared tunnel route dns <tunnel> panel.<domain>",
      },
      {
        title: "Deploy aplikasi",
        body: "Buat situs lewat wizard, lalu unggah binary Bun dari browser.",
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
        a: "Tidak. Panel Termux adalah satu binary native Android yang langsung jalan di Termux biasa, tanpa root dan tanpa Docker.",
      },
      {
        q: "Bagaimana dengan baterai?",
        a: "Biarkan HP tercolok charger. Panel menampilkan persen baterai, status pengisian, dan suhu, jadi kamu cepat tahu bila ada yang tidak beres.",
      },
      {
        q: "Aman dibuka ke internet?",
        a: "Panel hanya mendengarkan di 127.0.0.1 dan dibuka lewat Cloudflare Tunnel. Akun baru hanya mendapat peran Pengguna, nilai rahasia di pengaturan dienkripsi, dan aksi penting tercatat di log audit. Untuk lapisan tambahan, pasang Cloudflare Access di depan halaman panel.",
      },
      {
        q: "Aplikasi apa saja yang bisa jalan?",
        a: "Aplikasi web Bun yang di-compile jadi satu binary. Target bun-linux-arm64-android jalan langsung; target bun-linux-arm64 (glibc) jalan lewat grun. Setiap situs bisa punya database PostgreSQL sendiri dan dijalankan oleh pm2.",
      },
      {
        q: "Kalau HP rusak, bagaimana datanya?",
        a: "Cadangan harian dikirim ke luar HP, ke Cloudflare R2 atau S3: dump setiap database dan data panel, lengkap dengan perintah pemulihannya.",
      },
    ],
  },
  final: {
    title: "Laci kosong, server penuh.",
    body: "Ambil HP lama itu, colok ke charger, dan jalankan aplikasimu sendiri.",
  },
  footer: {
    tagline: "Panel web untuk menjadikan HP Android (Termux) sebagai server.",
    source: "Kode sumber di GitHub",
  },
} as const;
