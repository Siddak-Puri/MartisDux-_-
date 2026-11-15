"""Cache unchanged native NASA tiles around Jezero's landing site for clear startup."""
from pathlib import Path
import concurrent.futures,json,math,requests,threading,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public'/'terrain';OUT.mkdir(exist_ok=True,parents=True)
BASE='https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm'
clients=threading.local()
def session():
 if not hasattr(clients,'value'):clients.value=requests.Session()
 return clients.value
for x in [0,1]:
 p=OUT/'global'/'0'/'0'/f'{x}.lerc';p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():
  r=session().get(f'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer/tile/0/0/{x}',timeout=30);r.raise_for_status();p.write_bytes(r.content)
level=17;x=math.floor((77.4509+180)/360*2**(level+1));y=math.floor((90-18.4446)/180*2**level);radius=6
jobs=[(i,j) for j in range(y-radius,y+radius+1) for i in range(x-radius,x+radius+1)]
def tile(job):
 i,j=job;p=ROOT/'public'/'data'/'jezero-detail'/str(level)/str(j)/f'{i}.png';p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():
  for attempt in range(3):
   try:
    r=session().get(f'{BASE}/{level}/{j}/{i}.png',timeout=25);r.raise_for_status();assert r.content.startswith(b'\x89PNG');p.write_bytes(r.content);break
   except Exception:
    if attempt==2:raise
 return {'x':i,'y':j,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: records=list(pool.map(tile,jobs))
(ROOT/'public'/'data'/'jezero-detail'/'manifest.json').write_text(json.dumps({'title':'Native NASA Jezero HiRISE startup tiles','source':BASE,'level':level,'xMin':x-radius,'xMax':x+radius,'yMin':y-radius,'yMax':y+radius,'tileSize':256,'processing':'Original NASA PNG tiles unchanged. Runtime georeferenced mosaic, no generated pixels or sharpening.','tiles':records},indent=2)+'\n')
print('Cached',len(records),'native HiRISE tiles and two global terrain overviews.')
