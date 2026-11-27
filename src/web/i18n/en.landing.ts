import { msg } from "@/shared/i18n";

const REPO = "https://github.com/makurosolusi/panel-termux";

/** UI strings of the public landing page at `/` (imported directly by src/web/landing, also `id.landing`). */
export const tLanding = msg("landing", {
  /** Tab title + link preview; must equal `OG_TEXT` in src/server/http/seo.ts (tests/web.landing.test.ts). */
  meta: {
    title: "Panel Termux — HP Android jadi server",
    description:
      "Panel web yang mengubah HP Android dengan Termux jadi server untuk aplikasi Bun single-binary: pantau, deploy, backup, dan domain lewat Cloudflare Tunnel.",
    imageAlt:
      "Logo dan nama Panel Termux, tulisan pantau · deploy · backup · domain, dan tangkapan layar Ringkasan di HP",
  },
  links: {
    github: REPO,
    releases: `${REPO}/releases`,
    license: `${REPO}/blob/main/LICENSE`,
    changelog: `${REPO}/blob/main/CHANGELOG.md`,
    readmeInstall: `${REPO}#instal-di-hp`,
  },
  nav: {
    label: "Navigasi halaman",
    install: "Pasang",
    features: "Fitur",
    how: "Cara kerja",
    faq: "FAQ",
    github: "GitHub",
  },
  cta: {
    install: "Pasang di HP-mu",
    github: "Lihat di GitHub",
    signIn: "Masuk",
    open: "Buka panel",
    account: "Akun saya",
  },
  hero: {
    eyebrow: "Tanpa root · tanpa Docker",
    titleA: "HP lama di laci?",
    titleB: "Jadikan",
    titleEm: "server",
    titleC: "untuk aplikasimu.",
    lead: "Panel Termux mengubah HP Android dengan Termux jadi server untuk aplikasi web Bun. Buat situs, deploy, pantau, dan cadangkan dari browser, lewat Cloudflare Tunnel tanpa IP publik.",
    shotCaption: "Tangkapan layar dari mode demo, data contoh",
  },
  specs: {
    label: "Spesifikasi singkat",
    items: [
      { value: "1", unit: "binary", note: "native Android, jalan di Termux biasa" },
      { value: "~65", unit: "MB RAM", note: "diukur di HP sungguhan (v0.2)" },
      { value: "±30", unit: "menit", note: "penyiapan pertama, sekali saja" },
      { value: "0", unit: "root", note: "tanpa root, tanpa Docker" },
    ],
  },
  install: {
    kicker: "§01 — pasang",
    title: "Pasang di HP-mu.",
    lead: "Penyiapannya jujur saja: satu baris di Termux, beberapa pertanyaan, satu login Cloudflare, dan sekitar setengah jam termasuk membuat OAuth client Google. Setelah itu panel berjalan sendiri sebagai layanan di Termux.",
    prereqTitle: "Yang perlu disiapkan",
    prereqs: [
      "HP Android 64-bit (arm64) yang bisa dibiarkan menyala dan tercolok charger.",
      "Termux, Termux:Boot, dan Termux:API dari F-Droid (sumber yang sama untuk ketiganya), bukan Play Store.",
      "Domain yang dikelola di akun Cloudflare.",
      "Akun Google Cloud untuk membuat OAuth client login.",
      "Komputer untuk membuat OAuth client dengan nyaman dan mem-build aplikasimu.",
    ],
    stepsTitle: "Empat langkah",
    steps: [
      {
        title: "Jalankan baris ini di Termux",
        body: "Baris ini mengunduh panel dari rilis terbaru lalu menjalankan panel init. Init menampilkan rencananya dan bertanya sekali sebelum mulai, lalu memasang paket, PostgreSQL, layanan runit, dan Termux:Boot.",
      },
      {
        title: "Jawab pertanyaan init",
        body: "Alamat panel (mis. panel.domainmu.com), email Google pemilik, lalu Client ID dan Client secret OAuth client Google. Init mencetak redirect URI yang perlu kamu tempel di Google Cloud.",
        code: "panel docs google",
      },
      {
        title: "Login Cloudflare di browser",
        body: "Init membuka halaman login Cloudflare; pilih domainmu. Tunnel, DNS alamat panel, dan layanan cloudflared dibuat otomatis.",
      },
      {
        title: "Buka panel",
        body: "Init menyalakan panel, memeriksanya, dan mencetak alamatnya. Masuk dengan email Google tadi. Lalu pasang Cloudflare Access di depan /panel, /dev, /api/panel, dan /api/dev, dan atur baterai Android.",
        code: "panel docs android",
      },
    ],
    command:
      "cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/latest/download/panel && chmod +x panel-termux && ./panel-termux init",
    copy: "Salin baris pasang",
    viewReleases: "Lihat rilis",
    checksum: "Init mencocokkan SHA-256 binary dengan SHA256SUMS rilis sebelum memasang.",
    readme: "Panduan lengkap di README",
    upgrade: "Upgrade: jalankan baris yang sama. Unduhan terputus? Ulangi seluruh baris.",
  },
  shots: {
    kicker: "§02 — tampilan",
    title: "Seperti ini rupanya.",
    label: "Galeri tangkapan layar panel, geser untuk melihat semuanya",
    items: {
      overview: {
        caption: "Ringkasan di HP",
        alt: "Halaman Ringkasan di layar HP: baterai, suhu, memori, layanan, dan masalah terbaru",
      },
      sites: {
        caption: "Situs dan deploy",
        alt: "Daftar situs dengan status, domain, dan progres deploy di layar desktop",
      },
      health: {
        caption: "Kesehatan sistem",
        alt: "Halaman Kesehatan sistem di layar desktop: vonis, cadangan, dan pemeriksaan",
      },
      services: {
        caption: "Layanan di HP",
        alt: "Daftar layanan sshd, postgres, pm2, dan cloudflared beserta tombol mulai ulang di layar HP",
      },
    },
  },
  why: {
    kicker: "§03 — kenapa HP lama",
    title: "Server yang sudah kamu punya.",
    items: [
      { title: "UPS bawaan", body: "Baterai HP jadi cadangan daya. Listrik padam sebentar, server tetap berjalan." },
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
    kicker: "§04 — fitur",
    title: "Pekerjaan yang biasanya lewat SSH, kini dari browser.",
    items: [
      {
        title: "Wizard situs",
        body: "Satu alur membuat folder, database PostgreSQL, .env, entri pm2, rute Cloudflare Tunnel, dan DNS. Bila satu langkah gagal, langkah sebelumnya dikembalikan otomatis. Situs lama bisa diadopsi.",
        steps: ["folder", "postgres", ".env", "pm2", "tunnel", "dns"],
      },
      {
        title: "Deploy dari browser",
        body: "Unggah binary per potongan dengan checksum SHA-256, lalu panel mengecek kesehatannya. Bila gagal, versi lama kembali otomatis; versi sebelumnya bisa dikembalikan kapan saja.",
      },
      {
        title: "Pantau perangkat",
        body: "Baterai, status pengisian, suhu, memori, penyimpanan, dan beban sistem dalam satu layar.",
      },
      {
        title: "Layanan & aplikasi",
        body: "Mulai, hentikan, dan mulai ulang layanan runit (sshd, postgres, pm2, cloudflared) serta aplikasi pm2, lengkap dengan log.",
      },
      {
        title: "Cadangan di luar HP",
        body: "Setiap hari, semua database dan data panel dikirim ke Cloudflare R2 atau S3, dengan masa simpan yang bisa diatur. Perintah pemulihan tinggal disalin.",
      },
      {
        title: "Akses & audit",
        body: "Masuk dengan Google, tiga peran (Pengguna, Admin, Super Admin), log audit untuk aksi penting, dan nilai rahasia tersimpan terenkripsi. Admin punya kendali penuh atas HP.",
      },
    ],
  },
  how: {
    kicker: "§05 — cara kerja",
    title: "Dari laci ke internet dalam empat langkah.",
    steps: [
      {
        title: "Siapkan Termux",
        body: "Pasang Termux, Termux:Boot, dan Termux:API dari F-Droid.",
      },
      {
        title: "Pasang panel dari rilis GitHub",
        body: "Satu baris mengunduh panel; panel init memasang paket, PostgreSQL, dan layanan runit.",
        code: "./panel-termux init",
      },
      {
        title: "Hubungkan domain",
        body: "Init membuat Cloudflare Tunnel dan DNS alamat panel. Panel hanya mendengarkan di 127.0.0.1.",
        code: "panel doctor",
      },
      {
        title: "Deploy aplikasi",
        body: "Buat situs lewat wizard, lalu unggah binary Bun dari browser.",
        code: "bun build --compile --target=bun-linux-arm64-android",
      },
    ],
  },
  arch: {
    kicker: "§06 — arsitektur",
    title: "Koneksi keluar saja. Tidak ada port yang dibuka.",
    lead: "cloudflared di HP membuka tunnel keluar ke Cloudflare. Pengunjung datang lewat domainmu, Cloudflare meneruskannya ke tunnel.",
    label: "Diagram alur: HP Android ke cloudflared ke Cloudflare ke internet",
    nodes: [
      { title: "HP Android", detail: "Termux · panel :3200 · aplikasi :3001–3999" },
      { title: "cloudflared", detail: "layanan runit · tunnel keluar" },
      { title: "Cloudflare", detail: "DNS · Tunnel · Access" },
      { title: "Internet", detail: "https://app.domainmu" },
    ],
  },
  limits: {
    kicker: "§07 — keterbatasan",
    title: "Yang perlu kamu tahu sebelum memasang.",
    items: [
      {
        title: "Tanpa CPU% per proses",
        body: "Android memblokir /proc/stat, jadi panel tidak bisa menampilkan pemakaian CPU per proses.",
      },
      {
        title: "Domain putus sebentar",
        body: "Setiap perubahan domain memulai ulang cloudflared, sehingga semua domain di tunnel putus beberapa detik.",
      },
      {
        title: "Tidak bisa melapor bila mati",
        body: "Bila panel atau HP mati, panel tidak bisa memberi tahu. Pakai pemantau dari luar untuk itu.",
      },
      {
        title: "Optimasi baterai",
        body: "Android bisa menghentikan Termux bila optimasi baterai aktif. Matikan untuk Termux.",
      },
      {
        title: "Tanpa root, tanpa Docker",
        body: "Aplikasi harus berupa binary Bun (atau proses yang bisa dijalankan pm2). Container tidak didukung.",
      },
      {
        title: "Admin = kendali penuh",
        body: "Admin bisa menjalankan, menghapus, dan mengganti apa pun di HP. Berikan peran ini hanya ke orang yang kamu percaya.",
      },
      {
        title: "Login terbuka untuk akun Google",
        body: "Siapa pun bisa masuk sebagai Pengguna tanpa akses. Cloudflare Access praktis wajib di depan panel.",
      },
      {
        title: "Cadangan butuh R2 atau S3",
        body: "Tanpa bucket R2/S3 tidak ada cadangan di luar HP. Panggilan ke R2 dan API Cloudflare belum diuji end-to-end dengan akun nyata.",
      },
    ],
  },
  faq: {
    kicker: "§08 — tanya jawab",
    title: "Pertanyaan yang wajar.",
    items: [
      {
        q: "Perlu root?",
        a: "Tidak. Panel Termux adalah satu binary native Android yang jalan di Termux biasa, tanpa root dan tanpa Docker.",
      },
      {
        q: "Aman dibuka ke internet?",
        a: "Panel hanya mendengarkan di 127.0.0.1 dan dibuka lewat Cloudflare Tunnel. Akun baru hanya mendapat peran Pengguna tanpa akses, nilai rahasia dienkripsi, dan aksi penting tercatat di log audit. Pasang Cloudflare Access di depan halaman dan API panel: tanpa itu, halaman login terbuka untuk siapa saja.",
      },
      { q: "Gratis?", a: "Ya, kode terbuka berlisensi MIT." },
      {
        q: "Perlu komputer?",
        a: "Tidak untuk memasang panel; perlu untuk membuat OAuth client Google dan mem-build aplikasimu.",
      },
      {
        q: "Data saya dikirim ke kalian?",
        a: "Tidak ada telemetri. Panel hanya menghubungi layanan yang kamu atur (Cloudflare, bucket cadangan, Telegram) dan satu alamat Google untuk mengecek koneksi internet HP.",
      },
      {
        q: "Aplikasi apa saja yang bisa jalan?",
        a: "Aplikasi web Bun yang di-compile jadi satu binary. Target bun-linux-arm64-android jalan langsung; target bun-linux-arm64 (glibc) jalan lewat grun. Setiap situs bisa punya database PostgreSQL sendiri dan dijalankan oleh pm2.",
      },
      {
        q: "Bagaimana dengan baterai?",
        a: "Biarkan HP tercolok charger. Panel menampilkan persen baterai, status pengisian, dan suhu, jadi kamu cepat tahu bila ada yang tidak beres.",
      },
    ],
  },
  final: {
    title: "Laci kosong, server menyala.",
    body: "Ambil HP lama itu, colok ke charger, dan jalankan aplikasimu sendiri.",
  },
  accountDeleted: {
    title: "Akunmu sudah dihapus.",
    body: "Semua sesimu sudah berakhir. Kamu bisa masuk lagi kapan saja sebagai Pengguna baru.",
    close: "Tutup pemberitahuan",
  },
  footer: {
    tagline: "Panel web untuk menjadikan HP Android (Termux) sebagai server.",
    label: "Tautan proyek",
    github: "GitHub",
    license: "Lisensi MIT",
    changelog: "Catatan perubahan",
    releases: "Rilis",
  },
} as const);
