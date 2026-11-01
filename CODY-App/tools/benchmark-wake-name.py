import sys,json,wave,argparse
from pathlib import Path
r=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(r/'work/wake-lab'))
import numpy as np,sherpa_onnx
args=argparse.ArgumentParser();args.add_argument('--threshold',type=float,default=.45);args.add_argument('--blanks',type=int,default=1);opts=args.parse_args()
model=r/'work/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20';kw=r/'reports/wake-name-only.txt';kw.write_text('K OW1 D IY0 @CODY\n',encoding='utf-8')
k=sherpa_onnx.KeywordSpotter(tokens=str(model/'tokens.txt'),encoder=str(model/'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),decoder=str(model/'decoder-epoch-13-avg-2-chunk-16-left-64.onnx'),joiner=str(model/'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),keywords_file=str(kw),num_threads=1,num_trailing_blanks=opts.blanks,keywords_threshold=opts.threshold,keywords_score=1)
cases=json.loads((r/'reports/wake-regression/cases.json').read_text(encoding='utf-8-sig'));results=[]
for c in cases:
 if c['positive'] and not c['text'].startswith('Cody'):continue
 if not c['positive'] and 'Cody' in c['text']:continue
 with wave.open(str(r/'reports/wake-regression'/c['file'])) as w:sr=w.getframerate();a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
 a=np.interp(np.arange(0,len(a)*16000/sr)*sr/16000,np.arange(len(a)),a).astype(np.float32);a=np.concatenate([a,np.zeros(16000,dtype=np.float32)]);s=k.create_stream();found=False
 for i in range(0,len(a),320):
  s.accept_waveform(16000,a[i:i+320])
  while k.is_ready(s):
   k.decode_stream(s)
   if k.get_result(s):found=True;break
  if found:break
 results.append(dict(c,detected=found,passed=found==c['positive']))
report={'settings':vars(opts),'positive':sum(x['positive'] for x in results),'detected':sum(x['positive'] and x['detected'] for x in results),'misses':[x for x in results if x['positive'] and not x['detected']],'false':[x for x in results if not x['positive'] and x['detected']],'results':results}
(r/'reports/wake-name-comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='results'}))
