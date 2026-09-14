#!/usr/bin/env python3
"""curl + read-only DB verification, restricted to dedicated local integration fixtures."""
import json,subprocess,sqlite3,time
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'docs/quality/2026-09-08-web/evidence-batch2'
d=json.loads((out.parent/'integration-local.json').read_text());f=d['fixtures'][0]
assert d['api']=='http://127.0.0.1:60108/api/v1' and d['db'].startswith('/tmp/unit-stockmate-integration-batch2-')
token=None
calls=[]
def api(path,body=None,method=None):
 args=['curl','-fsS',d['api']+path,'-H','Content-Type: application/json']
 if method:args+=['-X',method]
 if token:args+=['-H','Authorization: Bearer '+token]
 if body is not None:args+=['--data-binary',json.dumps(body)]
 response=json.loads(subprocess.check_output(args));calls.append({'path':path,'code':response['code']});return response['data']
token=api('/auth/login',{'username':f['username'],'password':f['password']})['token']
name='Web核验专用品-'+str(int(time.time()))
p=api('/products',{'name':name,'productTypeId':f['typeId'],'skus':[{'price':10,'costPrice':6,'initQuantity':10}]})
sku=p['skus'][0]['id'];product=p['id']
body={'requestId':name,'supplierId':f['supplierId'],'settlementAccount':'挂账','items':[{'skuId':sku,'quantity':1,'unitPrice':100}]}
po=api('/purchase-orders',body);assert po['paidAmount']==0 and po['unpaidAmount']==100
replay=api('/purchase-orders',body);assert replay['id']==po['id']
paid=api('/purchase-orders/'+str(po['id'])+'/pay',{'amount':40,'settlementAccount':'微信'});assert paid['unpaidAmount']==60
api('/skus/'+str(sku),{'costPrice':6},'PUT')
order=api('/orders',{'customerId':f['customerId'],'settlementAccount':'现金','items':[{'skuId':sku,'quantity':2,'unitPrice':10}]})
item=order['items'][0]
ret=api('/orders/'+str(order['id'])+'/return',{'items':[{'itemId':item['id'],'quantity':1}]})
c=sqlite3.connect('file:'+d['db']+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
stock=c.execute('select quantity from Inventory where skuId=?',(sku,)).fetchone()[0];assert stock==10
purchasePayments=[dict(r) for r in c.execute('select direction,amount,account from PaymentRecord where purchaseOrderId=?',(po['id'],))];assert len(purchasePayments)==1 and purchasePayments[0]['amount']==40
net,cost=c.execute('select sum(netAmount),sum(costAmount) from TradeEvent where documentType=? and documentId=?',('sale',order['id'])).fetchone();assert net==10 and cost==6
assert c.execute('select count(*) from PurchaseOrderItem where skuId=?',(sku,)).fetchone()[0]==1
result={'api':d['api'],'verification':'real curl HTTP + read-only dedicated SQLite','storeId':f['storeId'],'createdFixtures':{'productId':product,'skuId':sku,'purchaseOrderId':po['id'],'orderId':order['id']},'purchase':{'total':100,'paid':40,'unpaid':60,'payments':purchasePayments,'replaySameId':True},'saleAfterReturn':{'netSales':net,'netCost':cost,'profit':net-cost,'stock':stock},'calls':calls,'cleanup':'Dedicated shared integration DB retained for App; only these newly created fixture IDs belong to this probe. No production/existing business data accessed.'}
(out/'live-business.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
