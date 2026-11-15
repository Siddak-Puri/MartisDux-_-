"""Reproduce compact, real Jezero terrain samples from NASA/USGS's public DTM.
Requires numpy. Data are radial display heights; no procedural relief is added.
Run manually; distributed builds already contain the prepared datasets.
"""
from pathlib import Path
import concurrent.futures, gzip, hashlib, json, math, struct, threading, time, urllib.request
import numpy as np
import requests
clients=threading.local()
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT.parent.parent/'work'/'terrain-build'; WORK.mkdir(parents=True,exist_ok=True)
OUT=ROOT/'public'/'terrain'; OUT.mkdir(parents=True,exist_ok=True)
URL='https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
SOURCE='https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
R=3396190.; X=4577366.; Y=1106618.; W=21400; H=21488

def read_range(first,last):
    for attempt in range(4):
        try:
            if not hasattr(clients,'session'): clients.session=requests.Session()
            response=clients.session.get(URL,headers={'Range':f'bytes={first}-{last}'},timeout=35)
            data=response.content
            if response.status_code!=206 or len(data)!=last-first+1 or not response.headers.get('Content-Range','').startswith(f'bytes {first}-{last}/'):raise ValueError('Expected an exact HTTP byte range')
            return data
        except Exception:
            if attempt==3:raise
            time.sleep(attempt+1)

header=read_range(0,16383)
count=struct.unpack_from('<H',header,8)[0]
tags={}
for i in range(count):
    tag,kind,n,offset=struct.unpack_from('<HHII',header,10+12*i);tags[tag]=(kind,n,offset)
assert tags[256][2]==W and tags[257][2]==H and tags[259][2]==1
kind,n,offset=tags[273];assert kind==4 and n==H
offsets=np.frombuffer(read_range(offset,offset+n*4-1),dtype='<u4')

centre_col=round(math.radians(77.4509)*R-X-.5)
centre_row=round(Y-.5-math.radians(18.4446)*R)
jobs=[('jezero-context',0,0,W,H,16),('jezero-landing',centre_col-1024,centre_row-1024,2049,2049,1)]
manifest=[]
for name,col,row,width,height,step in jobs:
    rows=list(range(row,row+height,step)); cols=list(range(col,col+width,step))
    cache=WORK/name; cache.mkdir(exist_ok=True)
    def get_row(r):
        path=cache/f'{r}.row'
        if not path.exists():
            first=int(offsets[r])+col*4; path.write_bytes(read_range(first,first+width*4-1))
        data=np.frombuffer(path.read_bytes(),dtype='<f4')[::step]
        return r,data
    values=np.empty((len(rows),len(cols)),dtype=np.float32); index={r:i for i,r in enumerate(rows)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i,(r,data) in enumerate(pool.map(get_row,rows)):
            values[index[r]]=data
            if i%250==0: print(name,i,len(rows),flush=True)
    valid=np.isfinite(values)&(values>-20000)&(values<30000)
    minimum=float(values[valid].min()); maximum=float(values[valid].max())
    origin=math.floor(minimum/100)*100.; scale=.05
    quantized=np.full(values.shape,65535,dtype='<u2')
    q=np.round((values[valid]-origin)/scale)
    assert q.min()>=0 and q.max()<65535
    quantized[valid]=q.astype('<u2')
    payload=gzip.compress(quantized.tobytes(),compresslevel=9,mtime=0)
    filename=name+'.u16.gz';(OUT/filename).write_bytes(payload)
    info={'id':name,'url':'terrain/'+filename,'width':len(cols),'height':len(rows),'x0':X+col+.5,'y0':Y-row-.5,'step':step,'scale':scale,'offset':origin,'nodata':65535,'minimum':minimum,'maximum':maximum,'validFraction':float(valid.mean()),'sourceSpacing':1,'deliveredSpacing':step,'radius':R,'original':SOURCE,'sha256':hashlib.sha256(payload).hexdigest()}
    manifest.append(info);print('Prepared',name,quantized.shape,minimum,maximum,'valid',valid.mean(),'bytes',len(payload),flush=True)
(OUT/'jezero.json').write_text(json.dumps({'title':'NASA/USGS Jezero HiRISE DTM','source':'https://github.com/NASA-AMMOS/Landform/wiki/Links-to-Publicly-Available-Input-Data','credit':'NASA / JPL-Caltech / University of Arizona / USGS','datasets':manifest,'processing':'Nearest native pixel-centre sampling at 16 m for context, native 1 m near landing; height quantization to 0.05 m (maximum 0.025 m rounding error). No synthetic relief, sharpening or AI generation. Nodata remains masked.'},indent=2)+'\n')
