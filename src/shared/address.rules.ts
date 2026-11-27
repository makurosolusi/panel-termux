// Address shapes shared by the server and the CLI (`panel init` prompts), so both accept exactly the same input
// without the CLI loading the site layer.

/** Lowercase FQDN with at least one dot; restricted charset so it can be written to YAML unquoted. */
export const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Loose email shape check for SUPER_ADMIN_EMAILS entries. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
