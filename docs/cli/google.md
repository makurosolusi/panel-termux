# Google sign-in: creating an OAuth client

Panel Termux uses Google sign-in. You need one OAuth client from Google Cloud.
`panel init` asks for the Client ID and Client secret, then saves them in `~/panel/.env`.
Create the client first (the phone's browser works), then paste the values when asked.

## Steps

1. Open console.cloud.google.com and pick or create a project.
2. Open APIs & Services → OAuth consent screen. Fill in the app name and your email.
   While the app is in Testing, add the email of everyone who may sign in under Test users.
3. Open APIs & Services → Credentials → Create credentials → OAuth client ID.
4. Application type: Web application. Any name works, e.g. Panel Termux.
5. Under Authorized redirect URIs, add this address (exactly, no trailing slash):

```
<APP_BASE_URL>/api/auth/callback/google
```

Example: `https://panel.example.com/api/auth/callback/google`
To try it on the phone without a domain: `http://localhost:3200/api/auth/callback/google`
(replace 3200 if your `PORT` is different).

6. Press Create. Copy the Client ID and Client secret, then paste them when `panel init` asks.
   The secret is not shown while you type; init only prints its length.
7. Without init (or to change a value): edit `~/panel/.env` yourself:

```
APP_BASE_URL=https://panel.example.com
GOOGLE_CLIENT_ID=<Client ID>
GOOGLE_CLIENT_SECRET=<Client secret>
SUPER_ADMIN_EMAILS=you@example.com
```

8. Restart the panel: `sv restart panel`.

## Important

- `APP_BASE_URL` must match the start of the redirect URI exactly: http/https, domain and port.
- Google only accepts public https domains or `localhost`. LAN or Tailscale IPs are refused.
- The Client secret is a secret. Do not share it or paste it in a chat.
- Emails in `SUPER_ADMIN_EMAILS` become Super Admin on their first sign-in. Separate them with commas.

## When sign-in fails

- `redirect_uri_mismatch`: the redirect URI in Google differs from `APP_BASE_URL`.
  Make them match, save, wait a few minutes, then try again.
- `access_denied` while in Testing: the email is not in Test users yet.
- Empty `.env` template: `panel env > .env.new`. Check what `.env` contains: `panel doctor`.
