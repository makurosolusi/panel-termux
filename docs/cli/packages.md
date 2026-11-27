# Held packages: cloudflared and postgresql

`cloudflared` and `postgresql` are held (`apt-mark hold`), so `pkg upgrade` skips them.
Check: `apt-mark showhold`. Why:

- Upgrading `cloudflared` deletes its service folder, then installs the default run script
  plus a `down` file again. The tunnel stays down until your run script is restored.
- A major `postgresql` upgrade (e.g. 18 to 19) leaves the old database unreadable.
  `pg_upgrade` needs the old version's binaries, and the Termux repo does not provide them.

A hold only stops `pkg upgrade`. `pkg reinstall cloudflared` and `pkg install --reinstall`
still run while held, and take the tunnel down the same way.

## Upgrading cloudflared safely

Over ssh, first run `export SVDIR=$PREFIX/var/service`.

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

The last line must say `run:`. The backup lives outside the service folder because the upgrade
deletes that folder and installs the default run script (`--token-file`) plus a `down` file.

## Major PostgreSQL upgrade (dump, then restore)

Back up the databases **before** the upgrade. Afterwards the old data can no longer be read.

```
pg_dumpall -U postgres > ~/pg-all.sql
sv down postgres
apt-mark unhold postgresql
pkg install postgresql
mv $PREFIX/var/lib/postgresql $PREFIX/var/lib/postgresql.old
initdb -U postgres -D $PREFIX/var/lib/postgresql
sv up postgres
psql -U postgres -d postgres -f ~/pg-all.sql
apt-mark hold postgresql
```

The message `role "postgres" already exists` during the restore can be ignored. Check your
sites, then delete `postgresql.old` and `~/pg-all.sql` once everything is right.

## Incompletely installed packages

`panel doctor` reports "installed incompletely" when `dpkg -s <package>` does not end with
`installed` (e.g. `half-installed` or `unpacked`), usually because an install was interrupted.
Finish it without upgrading:

```
dpkg --configure -a
```

Do not run `pkg upgrade` to fix it. If the package is cloudflared or postgresql, follow the
safe upgrade steps above. The status `hold ok installed` means installed and held.

## Other things that change how the panel behaves

- Bun also loads `.env.local`, `.env.development`, `.env.production`, `.env.test` and
  `.env.*.local` from the panel folder. Merge their content into `~/panel/.env`, then delete them.
- `BUN_OPTIONS` and `BUN_BE_BUN=1` in the shell environment change how the panel binary runs.
  Do not set them for the panel service.

Check holds, the database version and extra `.env` files: `panel doctor`.
