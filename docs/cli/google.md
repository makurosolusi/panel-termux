# Login Google: membuat OAuth client

Panel Termux memakai login Google. Kamu butuh satu OAuth client dari Google Cloud.
`panel init` menanyakan Client ID dan Client secret, lalu menyimpannya di `~/panel/.env`.
Buat client-nya dulu (boleh dari browser HP), lalu tempel saat ditanya.

## Langkah

1. Buka console.cloud.google.com, pilih atau buat project.
2. Buka APIs & Services → OAuth consent screen. Isi nama aplikasi dan email kamu.
   Selama aplikasi berstatus Testing, tambahkan email setiap orang yang boleh login di Test users.
3. Buka APIs & Services → Credentials → Create credentials → OAuth client ID.
4. Application type: Web application. Nama bebas, mis. Panel Termux.
5. Di Authorized redirect URIs, tambahkan alamat ini (persis, tanpa garis miring di akhir):

```
<APP_BASE_URL>/api/auth/callback/google
```

Contoh: `https://panel.example.com/api/auth/callback/google`
Untuk mencoba di HP tanpa domain: `http://localhost:3200/api/auth/callback/google`
(ganti 3200 bila `PORT` kamu berbeda).

6. Tekan Create. Salin Client ID dan Client secret, lalu tempel saat `panel init` bertanya.
   Secret tidak tampil saat diketik; init hanya mencetak panjangnya.
7. Tanpa init (atau untuk mengganti nilai): isi sendiri `~/panel/.env`:

```
APP_BASE_URL=https://panel.example.com
GOOGLE_CLIENT_ID=<Client ID>
GOOGLE_CLIENT_SECRET=<Client secret>
SUPER_ADMIN_EMAILS=kamu@example.com
```

8. Mulai ulang panel: `sv restart panel`.

## Penting

- `APP_BASE_URL` harus sama persis dengan awal redirect URI: http/https, domain, dan port.
- Google hanya menerima domain https publik atau `localhost`. IP LAN atau Tailscale ditolak.
- Client secret itu rahasia. Jangan dibagikan atau ditempel di chat.
- Email di `SUPER_ADMIN_EMAILS` menjadi Super Admin saat login pertama. Pisahkan dengan koma.

## Bila login gagal

- `redirect_uri_mismatch`: redirect URI di Google berbeda dengan `APP_BASE_URL`.
  Samakan, simpan, tunggu beberapa menit, lalu coba lagi.
- `access_denied` saat status Testing: email belum ada di Test users.
- Template `.env` kosong: `panel env > .env.new`. Pemeriksaan isi `.env`: `panel doctor`.
