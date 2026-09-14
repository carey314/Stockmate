#!/usr/bin/env python3
"""Apply an explicitly reviewed additive SQLite upgrade after stopping writers.

Requires exact baseline and expected-target sqlite_master metadata, a fresh
backup destination, and the reviewed SQL hash. Never prints database rows.
The service lifecycle is deliberately handled by the deployment operator.
"""
import argparse
import collections
import importlib.util
import json
import os
from pathlib import Path
import sqlite3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('database', 'backup', 'sql', 'baseline', 'target', 'report'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--sql-sha256', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('rehearsal', Path(__file__).with_name('quality-production-copy-rehearsal.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    require = helper.require
    require(args.database.is_file(), 'source database missing')
    require(not args.backup.exists(), 'backup must not already exist')
    require(args.backup.parent.stat().st_mode & 0o777 == 0o700, 'backup parent must be private')
    require(helper.sha(args.sql) == args.sql_sha256, 'reviewed SQL hash mismatch')
    baseline = [tuple(row) for row in json.loads(args.baseline.read_text())]
    target = [tuple(row) for row in json.loads(args.target.read_text())]
    commands = helper.statements(args.sql.read_text())
    with helper.connect(args.database.resolve(), ro=True) as original:
        require(helper.structure(original) == baseline, 'baseline drift')
        require(original.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'baseline integrity')
    helper.backup(args.database.resolve(), args.backup.resolve())
    with helper.connect(args.backup.resolve(), ro=True) as snapshot:
        require(helper.structure(snapshot) == baseline, 'backup baseline drift')
        require(snapshot.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'backup integrity')
        tables = [row[0] for row in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        cols = {t: helper.columns(snapshot, t) for t in tables}
        rows = {t: helper.rows(snapshot, t, cols[t]) for t in tables}
        oldfk = collections.Counter(snapshot.execute('PRAGMA foreign_key_check').fetchall())
    db = sqlite3.connect(args.database.resolve(), timeout=15)
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        require(helper.structure(db) == baseline, 'baseline changed after backup')
        require(all(helper.rows(db, t, cols[t]) == rows[t] for t in tables), 'writers not stopped')
        for statement in commands:
            db.execute(statement)
        require(helper.structure(db) == target, 'target schema differs')
        require(all(helper.rows(db, t, cols[t]) == rows[t] for t in tables), 'old values or types changed')
        require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'target integrity')
        require(collections.Counter(db.execute('PRAGMA foreign_key_check').fetchall()) == oldfk, 'foreign key regression')
        newtables = sorted({r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} - set(tables))
        require(all(db.execute('SELECT COUNT(*) FROM ' + helper.quote(t)).fetchone()[0] == 0 for t in newtables), 'unexpected new rows')
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    report = {'status': 'committed', 'oldBusinessTables': len(tables) - int('sqlite_sequence' in tables),
              'oldValuesAndTypesPreserved': True, 'oldSequencePreserved': True,
              'newTables': newtables, 'integrity': 'ok', 'newForeignKeyViolations': 0,
              'exactTargetStructure': True, 'sqlSha256': helper.sha(args.sql),
              'backupSha256': helper.sha(args.backup), 'backupPath': str(args.backup),
              'serviceStarted': False, 'externalApiCalls': 0}
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    os.chmod(args.report, 0o600)
    print(json.dumps({'status': 'committed', 'oldBusinessTables': report['oldBusinessTables'],
                      'newTables': len(newtables), 'integrity': 'ok', 'oldValuesAndTypesPreserved': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'failed', 'errorType': type(error).__name__,
                          'detail': str(error) if isinstance(error, RuntimeError) else 'See deployment stage; database values suppressed'}))
        raise SystemExit(1)
