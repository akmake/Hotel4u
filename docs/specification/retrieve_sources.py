from pathlib import Path
import json, urllib.request, concurrent.futures, hashlib
base=Path(__file__).parent
sources=json.loads((base/'sources.json').read_text(encoding='utf-8'))
out=base/'evidence';out.mkdir(exist_ok=True)
def fetch(s):
    record={'id':s['id'],'url':s['url']}
    try:
        with urllib.request.urlopen(urllib.request.Request(s['url'],headers={'User-Agent':'Mozilla/5.0'}),timeout=25) as r:
            data=r.read();record['resolved_url']=r.url
        extension='.pdf' if data.startswith(b'%PDF') else '.html'
        (out/(s['id']+extension)).write_bytes(data)
        record.update(status='downloaded',bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),file=s['id']+extension)
    except Exception as e:record.update(status='failed',error=str(e))
    return record
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:results=list(pool.map(fetch,sources))
(out/'retrieval.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'downloaded':sum(x['status']=='downloaded' for x in results),'failed':[x['id'] for x in results if x['status']=='failed']}))
