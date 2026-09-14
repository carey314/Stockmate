#!/usr/bin/env python3
"""Read-only synthetic DB fingerprint. Never outputs records or credentials."""
import sqlite3,json,pathlib,hashlib,sys
root=pathlib.Path(__file__).resolve().parents[2]
meta=json.loads((root/'docs/quality/2026-09-14-platform/integration.json').read_text())
conn=sqlite3.connect(pathlib.Path(meta['db']).as_uri()+'?mode=ro',uri=True);conn.execute('PRAGMA query_only=ON');conn.execute('BEGIN')
out={}
for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
 quoted='"'+name.replace('"','""')+'"'
 rows=conn.execute('SELECT * FROM '+quoted).fetchall()
 # Canonical per-row bytes; table digest order does not depend on query plan.
 hashes=sorted(hashlib.sha256(json.dumps(row,ensure_ascii=False,default=str).encode()).hexdigest() for row in rows)
 out[name]={'rows':len(rows),'sha256':hashlib.sha256(''.join(hashes).encode()).hexdigest()}
conn.rollback();conn.close()
folder=root/'docs/quality/2026-09-14-web/live-data';mode=sys.argv[1] if len(sys.argv)>1 else 'before'
if mode=='after':
 before=json.loads((folder/'db-before.json').read_text());assert out==before,'Read-only acceptance unexpectedly changed database'
assert mode in ['before','after']
(folder/('db-'+mode+'.json')).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'mode':mode,'tables':len(out),'readOnly':True,'unchanged':True if mode=='after' else None}))
