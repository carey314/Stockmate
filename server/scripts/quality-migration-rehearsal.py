#!/usr/bin/env python3
"""Rehearse against metadata-only production clone and HEAD + batch1. Never connects to production."""
import json, os, sqlite3, subprocess, tempfile, hashlib, re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
evidence=root/'docs/quality/2026-09-08-web/evidence-batch2'
prisma=root/'server/node_modules/.bin/prisma'
env=dict(os.environ);env.pop('NODE_OPTIONS',None)
schema=root/'server/prisma/schema.prisma'
def command(args):return subprocess.check_output([str(prisma),*args],env=env,cwd=root,text=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='stockmate-upgrade-') as tmp:
 tmp=Path(tmp); metadata=json.loads((evidence/'production-schema-readonly.json').read_text())
 production=tmp/'production-schema-only.db'; c=sqlite3.connect(production)
 for typ in ['table','index','view','trigger']:
  for item in metadata['schema']:
   if item['type']==typ and item['sql']:c.execute(item['sql'])
 c.commit();c.close()
 head=tmp/'head.prisma';head.write_bytes(subprocess.check_output(['git','show','HEAD:server/prisma/schema.prisma'],cwd=root))
 baseline=tmp/'first-batch.db';c=sqlite3.connect(baseline)
 c.executescript(command(['migrate','diff','--from-empty','--to-schema-datamodel',str(head),'--script']))
 c.executescript((root/'server/prisma/migrations/20260908090000_accounting_snapshots_and_confirmation/migration.sql').read_text());c.close()
 results=[]
 for name,db in [('production-observed',production),('head-plus-batch1',baseline)]:
  sql=command(['migrate','diff','--from-url','file:'+str(db),'--to-schema-datamodel',str(schema),'--script'])
  # Prisma rebuilds User for this added defaulted column. Use reviewed additive DDL,
  # then require exact final schema equality below (any other User drift will fail).
  sql=re.sub(r'-- RedefineTables\nPRAGMA defer_foreign_keys=ON;.*?PRAGMA defer_foreign_keys=OFF;', 'ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;',sql,flags=re.S)
  if re.search(r'(?m)^\s*(DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE |INSERT INTO)',sql):raise RuntimeError('Nonadditive migration needs separate review: '+name)
  c=sqlite3.connect(db);before={};columns={}
  # Synthetic sentinel per old table; no real production records copied.
  for (table,) in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'").fetchall():
   cols=c.execute('pragma table_info("'+table+'")').fetchall();columns[table]=[r[1] for r in cols]
   values={}
   for _,col,typ,required,default,pk in cols:
    if default is not None:continue
    if not(required or pk):continue
    values[col]=1 if any(t in typ.upper() for t in ['INT','REAL','FLOAT']) else ('2026-09-08 00:00:00' if 'DATE' in typ.upper() else 'quality-'+col)
   names=','.join('"'+n+'"' for n in values)
   c.execute('INSERT INTO "'+table+'" ('+names+') VALUES ('+','.join('?' for _ in values)+')',list(values.values()))
  c.commit()
  for table,cols in columns.items():before[table]=c.execute('select '+','.join('"'+n+'"' for n in cols)+' from "'+table+'"').fetchall()
  c.executescript(sql)
  for table,cols in columns.items():assert c.execute('select '+','.join('"'+n+'"' for n in cols)+' from "'+table+'"').fetchall()==before[table],table
  assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
  # Zero DDL diff to final current schema is required, not just successful SQL exit.
  c.close();diff=command(['migrate','diff','--from-url','file:'+str(db),'--to-schema-datamodel',str(schema),'--script'])
  assert 'CREATE ' not in diff and 'ALTER ' not in diff and 'DROP ' not in diff,diff
  output=evidence/(name+'-upgrade.sql');output.write_text(sql)
  if name=='head-plus-batch1':
   migration=root/'server/prisma/migrations/20260908160000_apple_sms_identity';migration.mkdir(exist_ok=True);(migration/'migration.sql').write_text(sql)
  results.append({'baseline':name,'oldTablesWithSyntheticSentinels':len(before),'oldColumnsUnchanged':True,'integrity':'ok','finalSchemaDiff':'empty','sqlSha256':digest(output)})
 (evidence/'migration-rehearsal.json').write_text(json.dumps({'targetSchemaSha256':digest(schema),'source':'read-only production schema metadata; synthetic sentinel rows only','results':results},indent=2))
 print(json.dumps(results,indent=2))
