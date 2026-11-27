# Cloudflare Tunnel: membuka panel dari internet

Panel hanya mendengar di `127.0.0.1`. Dari luar, panel dibuka lewat Cloudflare Tunnel: HP
menyambung keluar ke Cloudflare, jadi tidak perlu IP publik atau buka port router.
Kamu butuh domain yang sudah memakai Cloudflare.

## Yang dikerjakan panel sendiri

Setelah tunnel ada dan panel terbuka, kamu tidak perlu lagi menyentuh tunnel untuk situs.
Buat situs di panel: panel menambah rute ke `~/.cloudflared/config.yml` (dicek dulu dengan
`cloudflared tunnel ingress validate`), membuat DNS, lalu memulai ulang cloudflared.
DNS memakai Token API Cloudflare di Administrasi → Pengaturan bila diisi (izin Zone:Read
dan DNS:Edit), atau login cloudflared di HP.

## Sekali di awal: `panel init` mengerjakannya

`panel init` menjalankan `cloudflared tunnel login` dan membuka tautannya di browser HP.
Pilih domain kamu di halaman Cloudflare; hasilnya `~/.cloudflared/cert.pem`. Lalu init membuat
(atau memakai ulang) tunnel, menulis `~/.cloudflared/config.yml`, membuat DNS alamat panel,
dan memasang cloudflared sebagai layanan runit. Bila alamat itu sudah diarahkan ke tunnel
lain, init bertanya dulu sebelum memindahkannya.

## Bila memasang sendiri (tanpa init, atau `panel init --skip tunnel`)

1. `cloudflared tunnel login`, buka tautannya, pilih domain.
2. `cloudflared tunnel create <nama>`. Id tunnel: `cloudflared tunnel list`.
3. Tulis `~/.cloudflared/config.yml`:

```
tunnel: <nama>
credentials-file: /data/data/com.termux/files/home/.cloudflared/<id>.json
ingress:
  - hostname: panel.<domain>
    service: http://localhost:3200
  - service: http_status:404
```

4. Periksa: `cloudflared tunnel ingress validate`
5. Buat DNS panel: `cloudflared tunnel route dns <nama> panel.<domain>`
6. Tulis `$PREFIX/var/service/cloudflared/run` berisi tiga baris ini, lalu `sv-enable cloudflared`:

```
#!/data/data/com.termux/files/usr/bin/sh
export HOME=/data/data/com.termux/files/home
exec cloudflared tunnel --no-autoupdate run <nama> 2>&1
```

7. Isi `APP_BASE_URL=https://panel.<domain>` di `~/panel/.env`, lalu `sv restart panel`.

## Lindungi halaman privat dengan Cloudflare Access

Di dashboard Cloudflare: Zero Trust → Access controls → Applications → Self-hosted.
Satu aplikasi, satu public hostname per path: `panel`, `dev`, `api/panel`, `api/dev`
(tanpa `/*`). Policy Allow → Emails berisi email pemilik. Jangan kosongkan Path:
landing page dan login Google harus tetap publik. Rincian: README bagian Instal di HP.

## Rahasia

- `cert.pem`, `<id>.json`, dan token tunnel sama dengan kunci rumah. Jangan dibagikan.
- Jangan jalankan perintah yang mencetak token (`cloudflared tunnel token`) di depan orang
  lain atau di chat. Panel tidak pernah menampilkannya.

Pemeriksaan tunnel dan layanan: `panel doctor`. Upgrade cloudflared: `panel docs paket`.
