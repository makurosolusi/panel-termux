# Paket yang ditahan: cloudflared dan postgresql

`cloudflared` dan `postgresql` ditahan (`apt-mark hold`), jadi `pkg upgrade` melewatinya.
Cek: `apt-mark showhold`. Alasannya:

- Upgrade `cloudflared` menghapus folder layanannya, lalu memasang lagi run script bawaan
  plus file `down`. Tunnel mati sampai run script kamu dipulihkan.
- Upgrade mayor `postgresql` (mis. 18 ke 19) membuat database lama tidak bisa dibuka.
  `pg_upgrade` butuh binary versi lama, dan repo Termux tidak menyediakannya.

Hold hanya menahan `pkg upgrade`. `pkg reinstall cloudflared` dan `pkg install --reinstall`
tetap jalan walau ditahan, dan mematikan tunnel dengan cara yang sama.

## Upgrade cloudflared dengan aman

Lewat ssh, jalankan dulu `export SVDIR=$PREFIX/var/service`.

```
S=$PREFIX/var/service/cloudflared
cp $S/run ~/cloudflared.run.bak
sv down cloudflared
apt-mark unhold cloudflared
pkg install cloudflared
cp ~/cloudflared.run.bak $S/run
chmod 700 $S/run
rm -f $S/down
sv up cloudflared
apt-mark hold cloudflared
sv status cloudflared
```

Hasil terakhir harus `run:`. Cadangan disimpan di luar folder layanan karena upgrade menghapus
folder itu dan memasang run script bawaan (`--token-file`) plus file `down`.

## Upgrade mayor PostgreSQL (dump lalu restore)

Cadangkan database **sebelum** upgrade. Setelah upgrade, data lama tidak bisa dibaca lagi.

```
pg_dumpall -U postgres > ~/pg-semua.sql
sv down postgres
apt-mark unhold postgresql
pkg install postgresql
mv $PREFIX/var/lib/postgresql $PREFIX/var/lib/postgresql.lama
initdb -U postgres -D $PREFIX/var/lib/postgresql
sv up postgres
psql -U postgres -d postgres -f ~/pg-semua.sql
apt-mark hold postgresql
```

Pesan `role "postgres" already exists` saat restore boleh diabaikan. Cek situs, lalu hapus
`postgresql.lama` dan `~/pg-semua.sql` bila semua sudah benar.

## Paket terpasang tidak lengkap

`panel doctor` melapor "terpasang tidak lengkap" bila `dpkg -s <paket>` tidak berakhir dengan
`installed` (mis. `half-installed` atau `unpacked`), biasanya karena pemasangan terputus.
Selesaikan tanpa upgrade:

```
dpkg --configure -a
```

Jangan jalankan `pkg upgrade` untuk memperbaikinya. Bila paketnya cloudflared atau postgresql,
ikuti langkah upgrade aman di atas. Status `hold ok installed` berarti terpasang dan ditahan.

## Hal lain yang mengubah perilaku panel

- Bun juga memuat `.env.local`, `.env.development`, `.env.production`, `.env.test`, dan
  `.env.*.local` dari folder panel. Gabungkan isinya ke `~/panel/.env`, lalu hapus file itu.
- `BUN_OPTIONS` dan `BUN_BE_BUN=1` di lingkungan shell mengubah cara binary panel berjalan.
  Jangan diset untuk layanan panel.

Pemeriksaan hold, versi database, dan file `.env` tambahan: `panel doctor`.
