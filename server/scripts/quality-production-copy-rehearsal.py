#!/usr/bin/env python3
"""Explicit RO capture, then offline additive migration verification. Never starts the app.

Run --capture-readonly once. Reuse its private directory with --reuse DIR.
Only redacted outcomes go into the repository. Raw rows never leave private SQLite files.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs/quality/2026-09-08-web/evidence-batch2'
SCHEMA = ROOT / 'server/prisma/schema.prisma'
SQL = EVIDENCE / 'production-observed-upgrade.sql'
PRIVATE = Path('/Users/carey/.config/stockmate')
stage = 'arguments'


def require(ok, label):
    if not ok:
        raise RuntimeError(label)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def connect(path, ro=False):
    return sqlite3.connect(path.as_uri() + ('?mode=ro' if ro else ''), uri=True)


def structure(c):
    return c.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()


def columns(c, table):
    return [row[1] for row in c.execute('PRAGMA table_info(' + quote(table) + ')')]


def rows(c, table, cols):
    # Type + length framed bytes preserve NULL, integer, float bits, text, BLOB and duplicates.
    result = collections.Counter()
    for row in c.execute('SELECT ' + ','.join(map(quote, cols)) + ' FROM ' + quote(table)):
        digest = hashlib.sha256()
        for value in row:
            if value is None:
                tag, data = b'n', b''
            elif isinstance(value, int):
                tag, data = b'i', str(value).encode()
            elif isinstance(value, float):
                tag, data = b'f', struct.pack('!d', value)
            elif isinstance(value, str):
                tag, data = b't', value.encode()
            else:
                tag, data = b'b', bytes(value)
            digest.update(tag + struct.pack('!Q', len(data)) + data)
        result[digest.digest()] += 1
    return result


def backup(source, destination):
    with connect(source, ro=True) as src, connect(destination) as dst:
        src.backup(dst)
    os.chmod(destination, 0o600)


def statements(sql):
    text = re.sub(r'--[^\n]*', '', sql)
    commands = [s.strip() for s in text.split(';') if s.strip()]
    require(all(re.match(r'^(ALTER TABLE "\w+" ADD COLUMN |CREATE TABLE |CREATE (?:UNIQUE )?INDEX )', s) for s in commands), 'nonadditive SQL')
    return commands


def run():
    global stage
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--capture-readonly', action='store_true')
    group.add_argument('--reuse', type=Path)
    parser.add_argument('--sql', type=Path, default=SQL, help='Reviewed additive SQL; use a versioned path for a new target')
    parser.add_argument('--report-name', default='production-data-rehearsal.json', help='Versioned evidence filename; preserve earlier target reports')
    args = parser.parse_args()
    require(re.fullmatch(r'[a-z0-9-]+\.json', args.report_name), 'report filename')
    selected_sql = args.sql.resolve()
    require(selected_sql.is_relative_to(ROOT), 'SQL must be reviewed in this repository')
    os.umask(0o077)
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(PRIVATE.stat().st_mode & 0o777 == 0o700, 'private parent permissions')
    work = args.reuse.resolve() if args.reuse else Path(tempfile.mkdtemp(prefix='production-upgrade-', dir=PRIVATE))
    require(work.is_relative_to(PRIVATE) and work.stat().st_mode & 0o777 == 0o700, 'private work directory')
    source = work / 'snapshot.db'
    if args.capture_readonly:
        stage = 'readonly_capture'
        remote = '''import os,sqlite3,sys,tempfile,shutil
os.umask(0o077)
directory=tempfile.mkdtemp(prefix="stockmate-ro-export-")
try:
 source=sqlite3.connect("file:/opt/stockmate/server/prisma/prod.db?mode=ro",uri=True,timeout=10)
 source.execute("PRAGMA query_only=ON")
 destination=sqlite3.connect(directory+"/snapshot.db")
 source.backup(destination,pages=256,sleep=0.05)
 source.close()
 assert destination.execute("PRAGMA integrity_check").fetchall()==[("ok",)]
 destination.close()
 os.chmod(directory+"/snapshot.db",0o600)
 with open(directory+"/snapshot.db","rb") as handle: shutil.copyfileobj(handle,sys.stdout.buffer)
finally:
 shutil.rmtree(directory)
'''
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with source.open('xb') as output, (work / 'capture-stderr.private').open('xb') as errors:
            result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-i', '/Users/carey/.ssh/id_ed25519_tencent', 'root@qxju.shop', 'python3 -c ' + shlex.quote(remote)], stdout=output, stderr=errors, timeout=180)
        require(result.returncode == 0, 'readonly capture failed')
        (work / 'capture.json').write_text(json.dumps({'startedUtc': started, 'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'method': 'SQLite mode=ro + query_only + backup API; SSH binary stream to private file; remote temporary copy removed', 'snapshotSha256': sha(source)}, indent=2))
    stage = 'baseline_schema_and_integrity'
    capture = json.loads((work / 'capture.json').read_text())
    require(sha(source) == capture['snapshotSha256'], 'baseline hash')
    original = connect(source, ro=True)
    require(original.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'baseline integrity')
    metadata = json.loads((EVIDENCE / 'production-schema-readonly.json').read_text())
    expected = sorted((x['type'], x['name'], x['table'], x['sql']) for x in metadata['schema'])
    require(structure(original) == expected, 'production schema drift: review a new path')
    tables = [r[0] for r in original.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    oldcols = {table: columns(original, table) for table in tables}
    before = {table: rows(original, table, cols) for table, cols in oldcols.items()}
    oldfk = original.execute('PRAGMA foreign_key_check').fetchall()
    sql = selected_sql.read_text()
    commands = statements(sql)
    stage = 'local_upgrade'
    trial = Path(tempfile.mkdtemp(prefix='trial-', dir=work))
    upgraded = trial / 'upgraded.db'
    backup(source, upgraded)
    c = connect(upgraded)
    c.execute('PRAGMA foreign_keys=ON')
    start = time.monotonic()
    c.execute('BEGIN IMMEDIATE')
    for command in commands:
        c.execute(command)
    c.commit()
    elapsed = round(time.monotonic() - start, 4)
    stage = 'old_rows_defaults_fk'
    preserved = {table: rows(c, table, cols) == before[table] for table, cols in oldcols.items()}
    require(all(preserved.values()), 'old values changed')
    summaries = {
        'inventoryByStore': 'SELECT storeId, SUM(quantity) FROM Inventory GROUP BY storeId ORDER BY storeId',
        'salesByStoreAndStatus': 'SELECT storeId, status, SUM(actualAmount), SUM(paidAmount), SUM(actualAmount-paidAmount) FROM "Order" GROUP BY storeId,status ORDER BY storeId,status',
        'purchasesByStoreAndStatus': 'SELECT storeId, status, SUM(actualAmount), SUM(paidAmount), SUM(actualAmount-paidAmount) FROM PurchaseOrder GROUP BY storeId,status ORDER BY storeId,status',
        'paymentsByStoreAndDirection': 'SELECT storeId,direction,SUM(amount) FROM PaymentRecord GROUP BY storeId,direction ORDER BY storeId,direction',
        'incomeByStore': 'SELECT storeId,SUM(amount) FROM Income GROUP BY storeId ORDER BY storeId',
        'expenseByStore': 'SELECT storeId,SUM(amount) FROM Expense GROUP BY storeId ORDER BY storeId',
    }
    aggregates = {name: original.execute(query).fetchall() == c.execute(query).fetchall() for name, query in summaries.items()}
    require(all(aggregates.values()), 'business aggregate changed')
    require(c.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'upgraded integrity')
    require(collections.Counter(c.execute('PRAGMA foreign_key_check').fetchall()) == collections.Counter(oldfk), 'FK regression')
    newtables = sorted({r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")} - set(tables))
    require(all(c.execute('SELECT count(*) FROM ' + quote(t)).fetchone()[0] == 0 for t in newtables), 'new identity or business rows')
    defaults = {}
    for table, cols in oldcols.items():
        for col in set(columns(c, table)) - set(cols):
            condition = 'IS NULL OR ' + quote(col) + ' != 0' if (table, col) == ('User', 'sessionVersion') else 'IS NOT NULL'
            defaults[table + '.' + col] = c.execute('SELECT count(*) FROM ' + quote(table) + ' WHERE ' + quote(col) + ' ' + condition).fetchone()[0] == 0
    require(all(defaults.values()), 'historical default or backfill mismatch')
    c.close()
    stage = 'prisma_schema_diff'
    target = trial / 'target.prisma'
    target.write_bytes(SCHEMA.read_bytes())
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': str(trial), 'DATABASE_URL': upgraded.as_uri(), 'CHECKPOINT_DISABLE': '1', 'PRISMA_HIDE_UPDATE_MESSAGE': '1'}
    prisma = ROOT / 'server/node_modules/.bin/prisma'
    def diff(args):
        result = subprocess.run([str(prisma), 'migrate', 'diff', *args, '--script'], cwd=trial, env=env, capture_output=True, timeout=60)
        require(result.returncode == 0, 'offline prisma diff failed')
        return result.stdout.decode()
    difference = diff(['--from-url', upgraded.as_uri(), '--to-schema-datamodel', str(target)])
    require(not re.sub(r'--[^\n]*', '', difference).strip(), 'target schema differs')
    (trial / 'final-schema-diff.sql').write_text(difference)
    # Independently build an EMPTY current target and compare all new constraints/defaults/indexes.
    targetdb = trial / 'target-empty.db'
    targetconn = connect(targetdb)
    targetconn.executescript(diff(['--from-empty', '--to-schema-datamodel', str(target)]))
    upgradedconn = connect(upgraded, ro=True)
    for table in newtables:
        for pragma in ('table_info', 'foreign_key_list', 'index_list'):
            def info(conn):
                return sorted(conn.execute('PRAGMA ' + pragma + '(' + quote(table) + ')').fetchall())
            require(info(targetconn) == info(upgradedconn), 'new table constraints differ')
        for row in targetconn.execute('PRAGMA index_list(' + quote(table) + ')'):
            query = 'PRAGMA index_xinfo(' + quote(row[1]) + ')'
            require(targetconn.execute(query).fetchall() == upgradedconn.execute(query).fetchall(), 'new index columns differ')
    targetconn.close()
    upgradedconn.close()
    stage = 'transaction_rollback'
    rollback = trial / 'rollback.db'
    backup(source, rollback)
    c = connect(rollback)
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('BEGIN IMMEDIATE')
    for command in commands:
        c.execute(command)
    c.rollback()
    require(structure(c) == structure(original), 'rollback schema')
    require(all(rows(c, t, cols) == before[t] for t, cols in oldcols.items()), 'rollback rows')
    require(c.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'rollback integrity')
    c.close()
    original.close()
    require(sha(source) == capture['snapshotSha256'], 'snapshot changed')
    require(all(p.stat().st_mode & 0o777 == 0o600 for p in work.rglob('*') if p.is_file()), 'private file permissions')
    report = {'status': 'passed', 'capture': capture, 'privateDirectory': str(work), 'productionModified': False, 'servicesStarted': False, 'externalApiCalls': 0, 'prismaEnvironment': 'allowlist; private cwd/schema; no application env or secrets loaded', 'selectedPath': str(SQL.relative_to(ROOT)), 'sqlSha256': sha(SQL), 'targetSchemaSha256': sha(SCHEMA), 'baselineMatchesObservedSchema': True, 'oldBusinessTables': len(tables) - int('sqlite_sequence' in tables), 'oldTableRowsAndTypesPreserved': preserved, 'oldSequencePreserved': preserved.get('sqlite_sequence'), 'newTablesEmpty': newtables, 'newColumnsDefaultsCorrect': defaults, 'integrity': 'ok before/after/rollback', 'preexistingForeignKeyViolationCount': len(oldfk), 'newForeignKeyViolations': 0, 'newConstraintsAndIndexesMatchEmptyTarget': True, 'finalPrismaDiff': 'empty', 'rollbackSchemaAndAllOldValues': True, 'baselineFileUnchanged': True, 'localDdlSeconds': elapsed, 'permissions': 'directory 0700; all files 0600', 'limits': ['Point-in-time snapshot only; not production rollout or peak-load downtime proof', 'No production user operations; old FK anomalies if any remain unchanged', 'No SMS/Apple/AI calls; no server startup; uploaded files not included', 'Before deployment recheck live schema/code and make a fresh maintenance backup']}
    report['selectedPath'] = str(selected_sql.relative_to(ROOT))
    report['sqlSha256'] = sha(selected_sql)
    output = EVIDENCE / args.report_name
    report['rehearsalDirectory'] = str(trial)
    report['businessAggregatesUnchanged'] = aggregates
    report['rehearsalScriptSha256'] = sha(Path(__file__))
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'evidence': str(output.relative_to(ROOT)), 'privateDirectory': str(work), 'oldBusinessTables': report['oldBusinessTables'], 'newTables': len(newtables), 'finalPrismaDiff': 'empty', 'rollback': 'passed', 'externalApiCalls': 0}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        # Never emit DB content, provider config, stdout buffers or exception details.
        print(json.dumps({'status': 'failed', 'stage': stage, 'errorType': type(error).__name__}))
        raise SystemExit(1)
