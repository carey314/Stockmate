#!/usr/bin/env python3
"""Read-only checks of this batch's private synthetic database; outputs aggregates only."""
import json, sqlite3, pathlib, hashlib, stat
root=pathlib.Path(__file__).resolve().parents[2]
quality=root/'docs/quality/2026-09-14-platform'
meta=json.loads((quality/'integration.json').read_text())
browser=json.loads((quality/'evidence/browser.json').read_text())
private=pathlib.Path(meta['privateDir']); dbpath=pathlib.Path(meta['db'])
assert stat.S_IMODE(private.stat().st_mode)==0o700
for file in (dbpath,pathlib.Path(meta['fixturePath']),private/'runtime-keys.json'):
 assert stat.S_IMODE(file.stat().st_mode)==0o600
con=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True);con.execute('PRAGMA query_only=ON')
assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
batch=browser['batchId'];codes=con.execute('SELECT id,state,storeId,userId,entitlementId FROM PromoCode WHERE batchId=?',(batch,)).fetchall()
assert len(codes)==2 and sorted(r[1] for r in codes)==['disabled','revoked']
revoked=next(r for r in codes if r[1]=='revoked')
ent=con.execute('SELECT source,externalId,storeId,plan,status,expiresAt FROM Entitlement WHERE id=?',(revoked[4],)).fetchone()
assert ent==('promotion',revoked[0],revoked[2],'pro','canceled',None)
for action in ['promo.redeem','promo.revoke']:
 assert con.execute('SELECT count(*) FROM PlatformAudit WHERE targetId=? AND action=?',(revoked[0],action)).fetchone()[0]==1
assert con.execute('SELECT count(*) FROM PlatformAudit WHERE targetId=? AND action=?',(batch,'promo.batch.create')).fetchone()[0]==1
assert con.execute('SELECT count(*) FROM PlatformAudit WHERE targetId=? AND action=?',(batch,'promo.batch.recover')).fetchone()[0]==1
assert con.execute('SELECT count(*),sum(promptTokens),sum(completionTokens),sum(totalTokens) FROM AiRequestRecord').fetchone()==(2,100,20,120)
assert con.execute('SELECT count(*) FROM User').fetchone()[0]==1
assert con.execute('SELECT count(*) FROM Store').fetchone()[0]==1
report=json.loads((quality/'evidence/production-platform-rehearsal.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(root/'server/prisma/schema.prisma')==report['targetSchemaSha256']
assert sha(quality/'evidence/production-platform-upgrade.sql')==report['sqlSha256']
assert sha(pathlib.Path(report['privateDirectory'])/'snapshot.db')==report['capture']['snapshotSha256']
result={'passed':True,'readOnly':True,'syntheticOnly':True,'privatePermissions':'0700/0600','batchCodes':2,'states':['disabled','revoked'],'grantMatchesClaim':True,'grantExpiresAt':None,'grantStatus':'canceled','createRecoverRedeemRevokeEachOnce':True,'users':1,'stores':1,'aiAttempts':2,'knownTokens':120,'unchangedTargetSchemaAndSqlAndOriginalSnapshot':True,'historicalHarnessBatchesRetained':con.execute('SELECT count(*) FROM PromoBatch').fetchone()[0]-1}
(quality/'evidence/database-readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
con.close();print('Read-only synthetic database and final schema/snapshot checks passed')
