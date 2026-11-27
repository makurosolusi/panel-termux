// test-only: shaped like the POCO phone's hand-written ~/sites/ecosystem.config.js (25 Nov), values redacted.
const SITES = '/data/data/com.termux/files/home/sites'
const site = (name) => ({ name, cwd: `${SITES}/${name}`, script: '/data/data/com.termux/files/usr/bin/grun', args: './app', interpreter: 'none', exp_backoff_restart_delay: 1000 })
module.exports = {
  apps: [
    site('makuro-solusi'),
    // Admin DB: sengaja hanya 127.0.0.1, dibuka lewat tunnel
    { name: 'adminneo', cwd: `${SITES}/adminneo`, script: '/data/data/com.termux/files/usr/bin/php', args: `-d session.save_path=${SITES}/adminneo/sess -S 127.0.0.1:8080 index.php`, interpreter: 'none', exp_backoff_restart_delay: 1000, env: { ADMIN_PASS: 'test-only-secret-value' } },
  ],
}
