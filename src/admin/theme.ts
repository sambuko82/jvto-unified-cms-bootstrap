// src/admin/theme.ts — dark-theme tokens + HTML helpers for the admin console,
// reusing the visual language of scripts/render-cms.mjs (POLICY badges, slate
// palette) so the console matches the static projection.

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// write-policy / status → badge (ported from render-cms POLICY_BADGE).
const BADGES: Record<string, { label: string; color: string; bg: string }> = {
  editable: { label: 'Editable', color: '#34d399', bg: 'rgba(16,185,129,.12)' },
  read_only: { label: 'Synced · read-only', color: '#38bdf8', bg: 'rgba(14,165,233,.12)' },
  compliance_only: { label: 'Facts-locked', color: '#fb7185', bg: 'rgba(244,63,94,.12)' },
  published: { label: 'Published', color: '#34d399', bg: 'rgba(16,185,129,.12)' },
  draft: { label: 'Draft', color: '#fbbf24', bg: 'rgba(245,158,11,.12)' },
  context: { label: '—', color: '#64748b', bg: 'rgba(100,116,139,.10)' },
};

export function badge(kind: string): string {
  const b = BADGES[kind] ?? BADGES.context!;
  return `<span class="badge" style="color:${b.color};background:${b.bg};border-color:${b.color}55">${esc(b.label)}</span>`;
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#0b1120; color:#e2e8f0; }
  a { color:#7dd3fc; text-decoration:none; } a:hover { text-decoration:underline; }
  header { padding:16px 20px; border-bottom:1px solid #1e293b; background:#0f172a; position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:12px; }
  header h1 { margin:0; font-size:16px; color:#f8fafc; }
  header .crumbs { color:#94a3b8; font-size:12px; }
  header .spacer { margin-left:auto; }
  main { padding:20px; max-width:1000px; margin:0 auto; }
  h2 { font-size:15px; color:#f1f5f9; border-bottom:1px solid #1e293b; padding-bottom:6px; text-transform:uppercase; letter-spacing:.06em; }
  .group { margin:10px 0 26px; } .group h3 { font-size:12px; color:#cbd5e1; margin:0 0 8px; text-transform:uppercase; letter-spacing:.05em; }
  .count { display:inline-block; background:#1e293b; color:#93c5fd; border-radius:999px; padding:0 8px; font-size:11px; margin-left:6px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#64748b; font-weight:500; padding:6px 10px; border-bottom:1px solid #1e293b; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  td { padding:8px 10px; border-bottom:1px solid #1e293b; vertical-align:middle; }
  td.route { font-family:ui-monospace,monospace; color:#7dd3fc; }
  .badge { font-size:10px; padding:1px 7px; border:1px solid; border-radius:999px; white-space:nowrap; }
  .card { border:1px solid #1e293b; border-radius:10px; background:#0f172a; padding:16px; margin:0 0 18px; }
  .card h3 { margin:0 0 4px; font-size:14px; color:#f8fafc; }
  .card .ro { color:#64748b; font-size:12px; margin-bottom:12px; }
  label { display:block; font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:.04em; margin:12px 0 4px; }
  input[type=text], input[type=password], textarea, select { width:100%; background:#0b1120; color:#e2e8f0; border:1px solid #334155; border-radius:7px; padding:8px 10px; font:13px/1.4 inherit; }
  textarea { min-height:150px; font-family:ui-monospace,monospace; }
  input:focus, textarea:focus, select:focus { outline:none; border-color:#38bdf8; }
  button { background:#1d4ed8; color:#fff; border:0; border-radius:7px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; margin-top:14px; }
  button:hover { background:#2563eb; } button.secondary { background:#334155; }
  .flash { padding:10px 12px; border-radius:8px; margin:0 0 16px; font-size:13px; }
  .flash.ok { background:rgba(16,185,129,.12); color:#34d399; border:1px solid #34d39955; }
  .flash.err { background:rgba(244,63,94,.12); color:#fb7185; border:1px solid #fb718555; }
  .flash ul { margin:6px 0 0; padding-left:18px; }
  .muted { color:#475569; } .ro-field { color:#94a3b8; font-family:ui-monospace,monospace; font-size:12px; }
  code { font-family:ui-monospace,monospace; color:#93c5fd; }
`;

export function layout(opts: { title: string; crumbs?: string; authed?: boolean; body: string }): string {
  const nav = opts.authed
    ? `<span class="crumbs">${esc(opts.crumbs ?? '')}</span><span class="spacer"></span>
       <a href="/admin">Dashboard</a> · <a href="/admin/entities">Entities</a> · <a href="/admin/publishing">Publishing</a> ·
       <form method="POST" action="/admin/logout" style="display:inline;margin:0">
         <button class="secondary" style="margin:0;padding:4px 10px">Log out</button></form>`
    : `<span class="crumbs">${esc(opts.crumbs ?? '')}</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · JVTO CMS</title><style>${STYLE}</style></head>
<body><header><h1>JVTO CMS Console</h1>${nav}</header><main>${opts.body}</main></body></html>`;
}
