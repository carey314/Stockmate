#!/usr/bin/env python3
"""Rehearse the reviewed additive upgrade on a consistent copy of LOCAL dev.db only.
No service starts, original writes, production connections, or external provider env.
"""
import importlib.util,pathlib,tempfile,sqlite3,json,os,subprocess,shutil,datetime
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('rehearsal',root/'server/scripts/quality-production-copy-rehearsal.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
os.umask(0o077)
private=pathlib.Path.home()/'.config/stockmate';work=pathlib.Path(tempfile.mkdtemp(prefix='local-dev-upgrade-',dir=private))
source=root/'server/prisma/dev.db';snapshot=work/'snapshot.db';trial=work/'upgraded.db';rollback=work/'rollback.db'
h.backup(source,snapshot);h.backup(snapshot,trial);h.backup(snapshot,rollback)
original=h.connect(snapshot,ro=True);tables=[r[0] for r in original.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")];cols={t:h.columns(original,t) for t in tables};before={t:h.rows(original,t,cols[t]) for t in tables};originalStructure=h.structure(original)
script=root/'docs/quality/2026-09-14-platform/evidence/production-platform-upgrade.sql';commands=h.statements(script.read_text())
c=h.connect(trial);c.execute('PRAGMA foreign_keys=ON');c.execute('BEGIN IMMEDIATE')
for command in commands:c.execute(command)
c.commit()
assert all(h.rows(c,t,cols[t])==before[t] for t in tables)
assert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
assert c.execute('PRAGMA foreign_key_check').fetchall()==original.execute('PRAGMA foreign_key_check').fetchall()
c.close()
r=h.connect(rollback);r.execute('BEGIN IMMEDIATE')
for command in commands:r.execute(command)
r.rollback();assert h.structure(r)==originalStructure;assert all(h.rows(r,t,cols[t])==before[t] for t in tables);r.close();original.close()
schema=work/'schema.prisma';shutil.copyfile(root/'server/prisma/schema.prisma',schema)
env={k:os.environ[k] for k in ['PATH','HOME','LANG'] if k in os.environ};env['TMPDIR']=str(work);env['DATABASE_URL']='file:'+str(trial)
result=subprocess.run([str(root/'server/node_modules/.bin/prisma'),'migrate','diff','--from-url','file:'+str(trial),'--to-schema-datamodel',str(schema),'--script'],cwd=work,env=env,capture_output=True,text=True,timeout=60)
assert result.returncode==0 and result.stdout.strip()=='-- This is an empty migration.'
current=h.connect(source,ro=True);assert h.structure(current)==originalStructure;current.close()
report={'passed':True,'sourceKind':'LOCAL development database, not production','originalDatabase':str(source),'originalSchemaUnchanged':True,'privateDirectory':str(work),'snapshot':str(snapshot),'upgradedCopy':str(trial),'snapshotSha256':h.sha(snapshot),'sqlPath':str(script.relative_to(root)),'sqlSha256':h.sha(script),'targetSchemaSha256':h.sha(root/'server/prisma/schema.prisma'),'oldTables':len(tables),'oldValuesAndTypesPreserved':True,'integrity':'ok','newForeignKeyViolations':0,'prismaDiffEmpty':True,'localTransactionRollbackPassed':True,'servicesStarted':False,'externalCalls':0,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
folder=root/'docs/quality/2026-09-14-web/experience-profile';folder.mkdir(exist_ok=True)
(folder/'local-upgrade-rehearsal.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':True,'localCopyOnly':True,'oldTablesPreserved':len(tables),'prismaDiffEmpty':True,'privateDirectory':str(work)}))
