"""Топ функцій за self time з .cpuprofile (V8). python3 top-self.py file.cpuprofile"""
import json, sys, collections
p = json.load(open(sys.argv[1]))
nodes = {n['id']: n for n in p['nodes']}
dt = collections.Counter()
for sid, d in zip(p['samples'], p['timeDeltas']):
    dt[sid] += d
self_t = collections.Counter()
for nid, t in dt.items():
    cf = nodes[nid]['callFrame']
    name = cf['functionName'] or '(anonymous)'
    url = cf['url'].split('/')[-1]
    self_t[f"{name} ({url}:{cf['lineNumber']+1})" if url else name] += t
total = sum(self_t.values())
for k, v in self_t.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 10):
    print(f"{v/1000:8.1f} ms  {100*v/total:5.1f}%  {k}")
print(f"{total/1000:8.1f} ms  total")
