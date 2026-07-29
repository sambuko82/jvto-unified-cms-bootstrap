// pg-client.mjs — build a node-postgres Client that actually connects to a managed /
// self-signed remote Postgres. Copy this verbatim; it encodes a fix that cost two live
// iterations to discover.
//
// WHY explicit fields instead of { connectionString, ssl }:
//   When you pass a connectionString AND an ssl object, pg-connection-string parses the
//   URL's `sslmode` and it OVERRIDES your ssl object — `require`/`prefer`/`verify-ca` are
//   treated as verify-full, so the client verifies the cert and dies on a self-signed one
//   with `DEPTH_ZERO_SELF_SIGNED_CERT`. Building the config from explicit fields (no
//   connectionString) makes `ssl:{rejectUnauthorized:false}` authoritative.
//
// TLS policy: localhost/tests → plaintext; any remote host → TLS but accept the cert
// (we connect by IP, so hostname/CA verification is moot). `sslmode=disable` forces it off.
//
// Usage:
//   import pg from 'pg';
//   import { pgClient } from './pg-client.mjs';
//   const client = pgClient(process.env.TARGET_DATABASE_URL, pg);
//   await client.connect();
export function pgClient(connectionString, pg) {
  const u = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  const disable = u.searchParams.get('sslmode') === 'disable';
  return new pg.Client({
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), // URL-encoded @ (%40) etc. decoded here
    database: u.pathname.replace(/^\//, '') || 'postgres',
    ssl: local || disable ? false : { rejectUnauthorized: false },
    // A remote write over the internet does many round-trips; give it room.
    statement_timeout: 0,
    query_timeout: 0,
  });
}
