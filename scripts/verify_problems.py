import json,runpy,sys,ast
from pathlib import Path
root=Path(__file__).resolve().parents[1]
problems=json.loads((root/'content/problems.json').read_text(encoding='utf8'))
judge=runpy.run_path(str(root/'content/judge.py'))['judge'];errors=[];total=0
for p in problems:
    ast.parse(p['template'])
    result=judge(p,p['solution'],p['cases']);total+=len(p['cases'])
    if not result['passed']:errors.append({'id':p['id'],'result':result})
    if p['adapter']!='design':
        wrong=f"class Solution:\n    def {p['method']}(self, {p['params']}):\n        return None\n"
        if judge(p,wrong,p['cases'])['passed']:errors.append({'id':p['id'],'error':'trivial wrong solution passed'})
byid={p['id']:p for p in problems}
faults={
  1:'class Solution:\n    def twoSum(self,nums,target):\n        d={x:i for i,x in enumerate(nums)}\n        return next([i,d[target-x]] for i,x in enumerate(nums) if target-x in d)',
  283:'class Solution:\n    def moveZeroes(self,nums):\n        return sorted(nums)',
  142:'class Solution:\n    def detectCycle(self,head):\n        return ListNode(head.val) if head else None',
  138:'class Solution:\n    def copyRandomList(self,head):\n        return head',
  146:'class LRUCache:\n    def __init__(self,capacity): self.d={}\n    def put(self,key,value):self.d[key]=value\n    def get(self,key):return self.d.get(key,-1)',
  155:'class MinStack:\n    def __init__(self):self.s=[]\n    def push(self,val):self.s.append(val)\n    def pop(self):self.s.pop()\n    def top(self):return self.s[-1]\n    def getMin(self):return self.s[-1]',
}
for id,code in faults.items():
    p=byid[id]
    if judge(p,code,p['cases'])['passed']:errors.append({'id':id,'error':'semantic fault passed'})
print(json.dumps({'problems':len(problems),'cases':total,'errors':errors},ensure_ascii=False,indent=2))
sys.exit(bool(errors))
