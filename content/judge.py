"""Shared CPython / Pyodide adapter. It is not a host Python security sandbox."""
import json, math, collections, itertools, heapq, bisect, functools, copy, traceback, io, contextlib
from collections import Counter, defaultdict, deque, OrderedDict
from typing import List, Optional
class ListNode:
    def __init__(self,val=0,next=None):self.val=val;self.next=next
class TreeNode:
    def __init__(self,val=0,left=None,right=None):self.val=val;self.left=left;self.right=right
class Node:
    def __init__(self,x=0,next=None,random=None):self.val=x;self.next=next;self.random=random
def linked(values):
    nodes=[ListNode(x) for x in values]
    for a,b in zip(nodes,nodes[1:]):a.next=b
    return (nodes[0] if nodes else None),nodes
def unlist(head):
    out=[];seen=set()
    while head:
        if id(head) in seen:raise ValueError('输出链表存在意外的环')
        if len(out)>20000:raise ValueError('输出链表过长')
        seen.add(id(head));out.append(head.val);head=head.next
    return out
def tree(values):
    if not values or values[0] is None:return None
    root=TreeNode(values[0]);q=deque([root]);i=1
    while q and i<len(values):
        n=q.popleft()
        for side in ['left','right']:
            if i<len(values) and values[i] is not None:
                child=TreeNode(values[i]);setattr(n,side,child);q.append(child)
            i+=1
    return root
def untree(root):
    out=[];q=deque([root]);seen=set()
    while q:
        n=q.popleft()
        if n is None:out.append(None);continue
        if id(n) in seen:raise ValueError('树有重复节点或环')
        if len(out)>20000:raise ValueError('输出树过大')
        seen.add(id(n));out.append(n.val);q.extend([n.left,n.right])
    while out and out[-1] is None:out.pop()
    return out
def normalize(x):
    if isinstance(x,ListNode):return unlist(x)
    if isinstance(x,TreeNode):return untree(x)
    if isinstance(x,(list,tuple)):return [normalize(v) for v in x]
    return x
def run_case(problem,code,raw):
    env=dict(globals());exec(compile(code,'solution.py','exec'),env)
    args=copy.deepcopy(raw);mode=problem['adapter'];nodes=[]
    if mode=='design':
        ops,values=args
        if not ops or ops[0]!=problem['method'] or len(ops)!=len(values):raise ValueError('设计题输入应为 [操作列表,参数列表]，第一项为构造函数')
        obj=env[problem['method']](*values[0]);out=[None]
        allowed={'LRUCache':{'get','put'},'MinStack':{'push','pop','top','getMin'},'Trie':{'insert','search','startsWith'},'MedianFinder':{'addNum','findMedian'}}[problem['method']]
        for op,v in zip(ops[1:],values[1:]):
            if op not in allowed:raise ValueError('无效的操作名')
            out.append(getattr(obj,op)(*v))
        return out
    if mode=='list0':args[0],nodes=linked(args[0])
    elif mode=='lists01':args[0],_=linked(args[0]);args[1],_=linked(args[1])
    elif mode=='listArray':args[0]=[linked(v)[0] for v in args[0]]
    elif mode in ('cycle','cycleEntry'):
        head,nodes=linked(args[0]);pos=args[1]
        if pos>=0:
            if not nodes or pos>=len(nodes):raise ValueError('环入口下标越界')
            nodes[-1].next=nodes[pos]
        args=[head]
    elif mode=='intersection':
        a,an=linked(args[0]);b,bn=linked(args[1]);shared,sn=linked(args[2]);nodes=sn
        if an:an[-1].next=shared
        else:a=shared
        if bn:bn[-1].next=shared
        else:b=shared
        args=[a,b]
    elif mode=='random':
        nodes=[Node(v[0]) for v in args[0]]
        for i,(_,r) in enumerate(args[0]):nodes[i].next=nodes[i+1] if i+1<len(nodes) else None;nodes[i].random=nodes[r] if r is not None else None
        args=[nodes[0] if nodes else None]
    elif mode in ('tree0','flatten','lca'):
        args[0]=tree(args[0])
        if mode=='lca':
            found={};q=[args[0]]
            while q:
                n=q.pop()
                if n:found[n.val]=n;q.extend([n.left,n.right])
            args[1]=found[args[1]];args[2]=found[args[2]]
    result=getattr(env['Solution'](),problem['method'])(*args)
    if mode=='inplace':return args[0]
    if mode=='cycleEntry':
        if result is None:return None
        if result not in nodes:raise ValueError('返回的不是原链表节点')
        return nodes.index(result)
    if mode=='intersection':
        if result is None:return None
        if result not in nodes or result is not nodes[0]:raise ValueError('必须返回原链表的首个共享节点')
        return result.val
    if mode=='lca':return result.val if result else None
    if mode=='flatten':
        out=[];seen=set();n=args[0]
        while n:
            if n.left is not None or id(n) in seen:raise ValueError('展开后的 left 必须为空且不能有环')
            seen.add(id(n));out.append(n.val);n=n.right
        return out
    if mode=='balanced':
        vals=[];seen=set()
        def walk(n):
            if not n:return 0
            if id(n) in seen:raise ValueError('树中有环或重复节点')
            seen.add(id(n));l=walk(n.left);vals.append(n.val);r=walk(n.right)
            if abs(l-r)>1:raise ValueError('树不满足高度平衡')
            return 1+max(l,r)
        walk(result);return vals==raw[0]
    if mode=='random':
        copies=[];seen=set();n=result
        while n:
            if n in nodes or id(n) in seen:raise ValueError('必须深复制，不能返回原节点或环')
            seen.add(id(n));copies.append(n);n=n.next
        return [[n.val,copies.index(n.random) if n.random is not None else None] for n in copies]
    if mode in ('list0','lists01','listArray') and result is None and problem['method'] not in ('isPalindrome',):return []
    if mode=='tree0' and result is None and problem['method']=='invertTree':return []
    return normalize(result)
def equal(actual,expected,mode,raw):
    if mode=='palindrome':return isinstance(actual,str) and actual in raw[0] and actual==actual[::-1] and len(actual)==expected
    if mode=='set':return isinstance(actual,list) and sorted(actual)==sorted(expected)
    if mode=='groups':return isinstance(actual,list) and sorted(sorted(x) for x in actual)==sorted(sorted(x) for x in expected)
    if mode=='unordered':return isinstance(actual,list) and sorted(json.dumps(x,sort_keys=True) for x in actual)==sorted(json.dumps(x,sort_keys=True) for x in expected)
    return type(actual)==type(expected) and actual==expected or (isinstance(actual,(float,int)) and not isinstance(actual,bool) and isinstance(expected,(float,int)) and not isinstance(expected,bool) and abs(actual-expected)<1e-8)
class BoundedOutput(io.StringIO):
    def write(self,text):
        if self.tell()+len(text)>20000:raise ValueError('输出超过20000字符限制')
        return super().write(text)
def judge(problem,code,cases):
    results=[];output=BoundedOutput()
    with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
        for case in cases:
            try:
                actual=run_case(problem,code,case['input']);expected=case.get('expected');checked='expected' in case
                passed=equal(actual,expected,problem.get('compare','exact'),case['input']) if checked else None
                results.append(dict(passed=passed,actual=actual,expected=expected,checked=checked))
            except Exception as e:results.append(dict(passed=False,error=type(e).__name__+': '+str(e)))
    return dict(results=results,stdout=output.getvalue(),passed=bool(results) and all(r.get('passed') is True for r in results))
