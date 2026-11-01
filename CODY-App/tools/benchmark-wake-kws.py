import sys,json,wave,time,argparse
from pathlib import Path
r=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(r/'work/wake-lab'))
import numpy as np, sherpa_onnx
args=argparse.ArgumentParser();args.add_argument('--paths',type=int,default=8);args.add_argument('--blanks',type=int,default=1);args.add_argument('--score',type=float,default=1);args.add_argument('--threshold',type=float,default=.25);opts=args.parse_args()
model=r/'work/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20'
kws=sherpa_onnx.KeywordSpotter(tokens=str(model/'tokens.txt'),encoder=str(model/'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),decoder=str(model/'decoder-epoch-13-avg-2-chunk-16-left-64.onnx'),joiner=str(model/'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),keywords_file=str(r/'reports/wake-kws-keywords.txt'),num_threads=1,max_active_paths=opts.paths,num_trailing_blanks=opts.blanks,keywords_threshold=opts.threshold,keywords_score=opts.score)
cases=json.loads((r/'reports/wake-regression/cases.json').read_text(encoding='utf-8-sig'));results=[];start=time.time()
for case in cases:
 with wave.open(str(r/'reports/wake-regression'/case['file'])) as wav:
  sr=wav.getframerate();a=np.frombuffer(wav.readframes(wav.getnframes()),dtype=np.int16).astype(np.float32)/32768
 # Resample in the harness to avoid native diagnostic noise for every clip.
 a=np.interp(np.arange(0,len(a)*16000/sr)*sr/16000,np.arange(len(a)),a).astype(np.float32);sr=16000
 stream=kws.create_stream();stream.accept_waveform(sr,a);stream.accept_waveform(sr,np.zeros(sr,dtype=np.float32));stream.input_finished();found=[]
 while kws.is_ready(stream):
  kws.decode_stream(stream);word=kws.get_result(stream)
  if word:found.append({'keyword':word});kws.reset_stream(stream)
 results.append(dict(case,found=found,accepted=bool(found)))
report={'settings':vars(opts),'seconds':time.time()-start,'positives':sum(c['positive'] for c in results),'positiveDetected':sum(c['positive'] and c['accepted'] for c in results),'falseTriggers':[c for c in results if not c['positive'] and c['accepted']],'misses':[c for c in results if c['positive'] and not c['accepted']],'results':results}
(r/'reports/wake-kws-benchmark.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='results'}))
