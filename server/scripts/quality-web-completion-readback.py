"""Read only the isolated Web QA DB; no production path accepted."""
import json, sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[2]
q = root / 'docs/quality/2026-09-14-web'
meta = json.loads((q / 'integration.json').read_text())
report = json.loads((q / 'evidence/browser-business.json').read_text())
path = Path(meta['db']).resolve()
assert path.parent.name.startswith('web-completion-') and path.name == 'integration.db'
db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
order = db.execute('SELECT id,totalAmount,actualAmount,paidAmount,storeId FROM "Order" WHERE id=?', (report['orderId'],)).fetchone()
assert order[1:] == (25, 24, 10, 1)
assert db.execute('SELECT COUNT(*) FROM "Order" WHERE notes=?', ('WEB-20260914-browser-loss-test-v2',)).fetchone()[0] == 1
assert db.execute('SELECT COUNT(*),SUM(amount) FROM PaymentRecord WHERE orderId=?', (order[0],)).fetchone() == (1, 10)
assert db.execute('SELECT type,quantity,beforeQuantity,afterQuantity FROM InventoryRecord WHERE relatedOrderId=?', (order[0],)).fetchall() == [('outbound', 2.5, 97.5, 95)]
assert db.execute('SELECT quantity,costSnapshot,costAmountCents FROM OrderItem WHERE orderId=?', (order[0],)).fetchone() == (2.5, 6, 1500)
assert db.execute('SELECT quantity FROM Inventory WHERE skuId=1').fetchone() == (95,)
assert db.execute('SELECT COUNT(*) FROM Product WHERE code=?', ('BROWSER-IMPORT',)).fetchone() == (1,)
assert db.execute('SELECT COUNT(*) FROM Product WHERE code=?', ('BROWSER-INVALID',)).fetchone() == (0,)
assert db.execute('SELECT COUNT(*),MAX(costPrice) FROM Sku WHERE code=?', ('BROWSER-IMPORT-1',)).fetchone() == (1, None)
assert db.execute('SELECT i.quantity FROM Inventory i JOIN Sku s ON s.id=i.skuId WHERE s.code=?', ('BROWSER-IMPORT-1',)).fetchone() == (12,)
assert db.execute('SELECT COUNT(*) FROM AiUsage').fetchone() == (0,)
assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
result = {'passed': True, 'readOnly': True, 'orderId': order[0], 'perTestOrderCount': 1, 'amounts': {'total': 25, 'receivable': 24, 'paid': 10, 'debt': 14}, 'paymentRecords': 1, 'inventoryRecords': 1, 'stockDelta': -2.5, 'costAmountCents': 1500, 'importProducts': 1, 'invalidProducts': 0, 'importStock': 12, 'unknownImportCostPreserved': True, 'aiUsageRecords': 0, 'integrity': 'ok', 'harnessNote': '首次脚本错误预期HTTP200，实际create正常返回201；保留其1张合成单。修正后的v2从库存97.5开始至95，仅新增1单/1收款/1扣库存。未删除或覆写首轮单。'}
(q / 'evidence/browser-database-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': True, 'perTestOrderCount': 1, 'paymentRecords': 1, 'inventoryRecords': 1, 'stockDelta': -2.5, 'importProducts': 1, 'aiUsageRecords': 0}))
