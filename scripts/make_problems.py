"""Authored summaries, reference implementations and independent examples for Hot100.
The official problem statements remain available through each original link.
"""
import json, ast
from pathlib import Path
from textwrap import dedent
ROOT=Path(__file__).resolve().parents[1]
problems=[]
def add(id,title,slug,category,method,params,desc,cases,code,adapter='call',compare='exact',hint='',complexity=''):
    body=dedent(code).strip()
    solution=body if adapter=='design' else 'class Solution:\n    def '+method+'(self, '+params+'):\n'+''.join('        '+line+'\n' for line in body.splitlines())
    template=f'class Solution:\n    def {method}(self, {params}):\n        # 在这里编写 Python3 解答\n        pass\n'
    if adapter=='design':
        cls=next(n for n in ast.parse(body).body if isinstance(n,ast.ClassDef))
        for fn in cls.body:
            if isinstance(fn,ast.FunctionDef):fn.body=[ast.Pass()]
        template=ast.unparse(cls)+'\n'
    problems.append(dict(id=id,title=title,slug=slug,category=category,difficulty=('困难' if id in [4,23,25,32,42,51,76,84,124,239,295] else '简单' if id in [1,20,21,70,94,101,104,108,118,121,136,141,160,169,206,226,234,283,543] else '中等'),method=method,params=params,description=desc,constraints='输入符合题意约定；本地用例覆盖合法输入的典型边界。完整平台约束见原题链接。',adapter=adapter,compare=compare,template=template,solution=solution,hints=[hint or '先明确输入输出和边界，再选择适合的数据结构。','先尝试小规模示例，分析哪些计算可以复用或提前剪枝。'],complexity=complexity or '请结合参考实现分析输入规模、循环层数和辅助空间。',cases=[dict(input=x,expected=y) for x,y in cases],version='2026-10-10'))

add(1,'两数之和','two-sum','哈希','twoSum','nums, target','返回两个不同下标，使对应整数之和等于 target。保证存在唯一答案。', [([[2,7,11,15],9],[0,1]),([[3,2,4],6],[1,2]),([[3,3],6],[0,1]),([[-2,1,4,6],4],[0,3])],'''
seen={}
for i,x in enumerate(nums):
    if target-x in seen: return [seen[target-x],i]
    seen[x]=i
''',compare='set',hint='用哈希表保存已经见过的数与下标。',complexity='时间 O(n)，额外空间 O(n)。')
add(49,'字母异位词分组','group-anagrams','哈希','groupAnagrams','strs','将字符组成相同的字符串归为一组，组与组内顺序不限。',[([['eat','tea','tan','ate','nat','bat']],[['eat','tea','ate'],['tan','nat'],['bat']]),([['']],[['']]),([['a','a','b']],[['a','a'],['b']])],'''
d=defaultdict(list)
for s in strs: d[''.join(sorted(s))].append(s)
return list(d.values())
''',compare='groups',hint='为每个字符串生成不受字符顺序影响的键。',complexity='总时间 O(n k log k)，k 为单词长度；空间 O(nk)。')
add(128,'最长连续序列','longest-consecutive-sequence','哈希','longestConsecutive','nums','找出无序整数数组中最长的连续整数序列长度，重复值只计算一次。',[([[100,4,200,1,3,2]],4),([[]],0),([[1,2,0,1]],3)],'''
s=set(nums);best=0
for x in s:
    if x-1 not in s:
        y=x
        while y in s: y+=1
        best=max(best,y-x)
return best
''',hint='仅从没有前驱的数开始扩展。',complexity='平均时间 O(n)，空间 O(n)。')
add(283,'移动零','move-zeroes','双指针','moveZeroes','nums','原地把所有零移动到数组末尾，并保持非零元素相对顺序。',[([[0,1,0,3,12]],[1,3,12,0,0]),([[0]],[0]),([[1,2]],[1,2])],'''
j=0
for i in range(len(nums)):
    if nums[i]!=0: nums[j],nums[i]=nums[i],nums[j];j+=1
''',adapter='inplace',hint='写指针只在遇到非零元素时前进。',complexity='时间 O(n)，空间 O(1)。')
add(11,'盛最多水的容器','container-with-most-water','双指针','maxArea','height','选择两根竖线，以较短高度乘间距作为面积，返回最大面积。',[([[1,8,6,2,5,4,8,3,7]],49),([[1,1]],1),([[4,3,2,1,4]],16)],'''
l=0;r=len(height)-1;best=0
while l<r:
    best=max(best,min(height[l],height[r])*(r-l))
    if height[l]<height[r]: l+=1
    else: r-=1
return best
''',hint='移动较短边才可能改善面积。',complexity='时间 O(n)，空间 O(1)。')
add(15,'三数之和','3sum','双指针','threeSum','nums','返回所有和为零的不重复三元组，不能重复使用同一下标。',[([[-1,0,1,2,-1,-4]],[[-1,-1,2],[-1,0,1]]),([[0,0,0,0]],[[0,0,0]]),([[1,2,-2,-1]],[])],'''
nums.sort();out=[]
for i in range(len(nums)-2):
    if i and nums[i]==nums[i-1]: continue
    l=i+1;r=len(nums)-1
    while l<r:
        total=nums[i]+nums[l]+nums[r]
        if total<0: l+=1
        elif total>0: r-=1
        else:
            out.append([nums[i],nums[l],nums[r]]);l+=1;r-=1
            while l<r and nums[l]==nums[l-1]: l+=1
            while l<r and nums[r]==nums[r+1]: r-=1
return out
''',compare='groups',hint='排序后固定一个数，再双指针查找另外两个。',complexity='时间 O(n²)，额外空间取决于排序与输出。')
add(42,'接雨水','trapping-rain-water','双指针','trap','height','相邻单位宽柱子形成凹槽，计算降雨后能存储的总水量。',[([[0,1,0,2,1,0,1,3,2,1,2,1]],6),([[4,2,0,3,2,5]],9),([[1,2,3]],0)],'''
l=0;r=len(height)-1;lm=rm=ans=0
while l<=r:
    if lm<=rm:
        lm=max(lm,height[l]);ans+=lm-height[l];l+=1
    else:
        rm=max(rm,height[r]);ans+=rm-height[r];r-=1
return ans
''',hint='每个位置的水位由左右最高边界中的较小者决定。',complexity='时间 O(n)，空间 O(1)。')
add(3,'无重复字符的最长子串','longest-substring-without-repeating-characters','滑动窗口','lengthOfLongestSubstring','s','返回不包含重复字符的最长连续子串长度。',[(['abcabcbb'],3),(['bbbbb'],1),([''],0),(['abba'],2)],'''
last={};left=ans=0
for i,c in enumerate(s):
    left=max(left,last.get(c,-1)+1);last[c]=i;ans=max(ans,i-left+1)
return ans
''',hint='左边界只能向右移动。',complexity='时间 O(n)，空间 O(字符集大小)。')
add(438,'找到字符串中所有字母异位词','find-all-anagrams-in-a-string','滑动窗口','findAnagrams','s, p','返回 s 中与 p 字符计数相同的所有等长子串的起点。',[(['cbaebabacd','abc'],[0,6]),(['abab','ab'],[0,1,2]),(['a','aa'],[])],'''
need=Counter(p);window=Counter();out=[]
for i,c in enumerate(s):
    window[c]+=1
    if i>=len(p):
        old=s[i-len(p)];window[old]-=1
        if window[old]==0: del window[old]
    if window==need: out.append(i-len(p)+1)
return out
''',hint='维护长度为 len(p) 的字符计数窗口。',complexity='固定小写字母表时，时间 O(n)，空间 O(1)。')
add(560,'和为 K 的子数组','subarray-sum-equals-k','子串','subarraySum','nums, k','统计连续子数组中元素和等于 k 的数量，元素可为负数。',[([[1,1,1],2],2),([[1,-1,0],0],3),([[1,2,3],3],2)],'''
counts={0:1};s=ans=0
for x in nums:
    s+=x;ans+=counts.get(s-k,0);counts[s]=counts.get(s,0)+1
return ans
''',hint='两个前缀和之差等于 k，需保存每个前缀和的出现次数。',complexity='时间 O(n)，空间 O(n)。')
add(239,'滑动窗口最大值','sliding-window-maximum','子串','maxSlidingWindow','nums, k','给定合法窗口宽度 k，返回每个连续窗口的最大值。',[([[1,3,-1,-3,5,3,6,7],3],[3,3,5,5,6,7]),([[1],1],[1]),([[9,8,7,6],2],[9,8,7])],'''
d=deque();out=[]
for i,x in enumerate(nums):
    while d and d[0]<=i-k: d.popleft()
    while d and nums[d[-1]]<=x: d.pop()
    d.append(i)
    if i>=k-1: out.append(nums[d[0]])
return out
''',hint='单调队列存放可能成为最大值的下标。',complexity='时间 O(n)，空间 O(k)。')
add(76,'最小覆盖子串','minimum-window-substring','子串','minWindow','s, t','找出 s 中覆盖 t 全部字符及其重数的最短子串，不存在返回空串。',[(['ADOBECODEBANC','ABC'],'BANC'),(['a','aa'],''),(['aa','aa'],'aa')],'''
need=Counter(t);missing=len(t);left=0;best=''
for right,c in enumerate(s):
    if need[c]>0: missing-=1
    need[c]-=1
    while missing==0:
        if not best or right-left+1<len(best): best=s[left:right+1]
        need[s[left]]+=1
        if need[s[left]]>0: missing+=1
        left+=1
return best
''',hint='覆盖成立后尽可能收缩左边界。',complexity='时间 O(n+m)，空间 O(字符集大小)。')
add(53,'最大子数组和','maximum-subarray','普通数组','maxSubArray','nums','非空整数数组中，求非空连续子数组的最大和。',[([[-2,1,-3,4,-1,2,1,-5,4]],6),([[-3,-1,-2]],-1),([[1]],1)],'''
cur=best=nums[0]
for x in nums[1:]: cur=max(x,cur+x);best=max(best,cur)
return best
''',hint='判断当前位置是接在前段之后，还是重新开始。',complexity='时间 O(n)，空间 O(1)。')
add(56,'合并区间','merge-intervals','普通数组','merge','intervals','合并所有相交或端点接触的闭区间。',[([[[1,3],[2,6],[8,10],[15,18]]],[[1,6],[8,10],[15,18]]),([[[1,4],[4,5]]],[[1,5]]),([[[1,4],[2,3]]],[[1,4]])],'''
out=[]
for a,b in sorted(intervals):
    if out and a<=out[-1][1]: out[-1][1]=max(out[-1][1],b)
    else: out.append([a,b])
return out
''',hint='先按区间起点排序。',complexity='时间 O(n log n)，空间 O(n)。')
add(189,'轮转数组','rotate-array','普通数组','rotate','nums, k','将数组原地向右轮转 k 步，k 为非负整数。',[([[1,2,3,4,5,6,7],3],[5,6,7,1,2,3,4]),([[-1,-100,3,99],2],[3,99,-1,-100]),([[1,2],4],[1,2])],'''
k%=len(nums)
def rev(l,r):
    while l<r: nums[l],nums[r]=nums[r],nums[l];l+=1;r-=1
rev(0,len(nums)-1);rev(0,k-1);rev(k,len(nums)-1)
''',adapter='inplace',hint='整段反转后分别反转前 k 项和剩余项。',complexity='时间 O(n)，空间 O(1)。')
add(238,'除自身以外数组的乘积','product-of-array-except-self','普通数组','productExceptSelf','nums','不使用除法，返回每个位置之外所有元素的乘积。',[([[1,2,3,4]],[24,12,8,6]),([[-1,1,0,-3,3]],[0,0,9,0,0]),([[0,0]],[0,0])],'''
out=[1]*len(nums);p=1
for i,x in enumerate(nums): out[i]=p;p*=x
p=1
for i in range(len(nums)-1,-1,-1): out[i]*=p;p*=nums[i]
return out
''',hint='前缀乘积与后缀乘积组合。',complexity='时间 O(n)，除返回数组外 O(1) 空间。')
add(41,'缺失的第一个正数','first-missing-positive','普通数组','firstMissingPositive','nums','找出数组没有出现的最小正整数，要求线性时间、常数辅助空间。',[([[1,2,0]],3),([[3,4,-1,1]],2),([[7,8,9,11,12]],1),([[1,1]],2)],'''
n=len(nums)
for i in range(n):
    while 1<=nums[i]<=n and nums[nums[i]-1]!=nums[i]:
        j=nums[i]-1;nums[i],nums[j]=nums[j],nums[i]
for i,x in enumerate(nums):
    if x!=i+1: return i+1
return n+1
''',hint='把数 x 放到下标 x-1 的位置，注意重复值。',complexity='时间 O(n)，空间 O(1)。')
add(73,'矩阵置零','set-matrix-zeroes','矩阵','setZeroes','matrix','若原矩阵某格为零，将其整行整列原地设为零。',[([[[1,1,1],[1,0,1],[1,1,1]]],[[1,0,1],[0,0,0],[1,0,1]]),([[[0,1]]],[[0,0]]),([[[1]]],[[1]])],'''
m=len(matrix);n=len(matrix[0]);row=any(x==0 for x in matrix[0]);col=any(r[0]==0 for r in matrix)
for i in range(1,m):
    for j in range(1,n):
        if matrix[i][j]==0: matrix[i][0]=matrix[0][j]=0
for i in range(1,m):
    for j in range(1,n):
        if matrix[i][0]==0 or matrix[0][j]==0: matrix[i][j]=0
if row: matrix[0][:]=[0]*n
if col:
    for r in matrix: r[0]=0
''',adapter='inplace',hint='首行首列作为标记，另外保存它们最初是否有零。',complexity='时间 O(mn)，空间 O(1)。')
add(54,'螺旋矩阵','spiral-matrix','矩阵','spiralOrder','matrix','从左上角开始，按顺时针螺旋顺序返回矩阵中的元素。',[([[[1,2,3],[4,5,6],[7,8,9]]],[1,2,3,6,9,8,7,4,5]),([[[1,2,3,4]]],[1,2,3,4]),([[[1],[2],[3]]],[1,2,3])],'''
top=left=0;bottom=len(matrix)-1;right=len(matrix[0])-1;out=[]
while top<=bottom and left<=right:
    out.extend(matrix[top][left:right+1]);top+=1
    for i in range(top,bottom+1): out.append(matrix[i][right])
    right-=1
    if top<=bottom:
        for j in range(right,left-1,-1): out.append(matrix[bottom][j])
        bottom-=1
    if left<=right:
        for i in range(bottom,top-1,-1): out.append(matrix[i][left])
        left+=1
return out
''',hint='每走完一条边就收缩对应边界。',complexity='时间 O(mn)，除输出外 O(1) 空间。')
add(48,'旋转图像','rotate-image','矩阵','rotate','matrix','将 n×n 方阵原地顺时针旋转90度。',[([[[1,2,3],[4,5,6],[7,8,9]]],[[7,4,1],[8,5,2],[9,6,3]]),([[[1]]],[[1]]),([[[1,2],[3,4]]],[[3,1],[4,2]])],'''
n=len(matrix)
for i in range(n):
    for j in range(i+1,n): matrix[i][j],matrix[j][i]=matrix[j][i],matrix[i][j]
for row in matrix: row.reverse()
''',adapter='inplace',hint='先转置，再反转每一行。',complexity='时间 O(n²)，空间 O(1)。')
add(240,'搜索二维矩阵 II','search-a-2d-matrix-ii','矩阵','searchMatrix','matrix, target','矩阵每行从左到右、每列从上到下递增，判断 target 是否存在。',[([[[1,4,7],[2,5,8],[3,6,9]],5],True),([[[1,4],[2,5]],3],False),([[[1]],1],True)],'''
r=0;c=len(matrix[0])-1
while r<len(matrix) and c>=0:
    if matrix[r][c]==target: return True
    if matrix[r][c]>target: c-=1
    else: r+=1
return False
''',hint='从右上角出发，每次排除一行或一列。',complexity='时间 O(m+n)，空间 O(1)。')

# Linked structures use explicit JSON adapters documented by the UI.
add(160,'相交链表','intersection-of-two-linked-lists','链表','getIntersectionNode','headA, headB','返回两条无环链表共享的首个节点，若不相交返回 None。输入：[A独立前缀,B独立前缀,共享后缀]；本地输出共享节点值。',[([[4,1],[5,6,1],[8,4,5]],8),([[1],[2],[]],None),([[],[],[3]],3)],'''
a=headA;b=headB
while a is not b:
    a=a.next if a else headB;b=b.next if b else headA
return a
''',adapter='intersection',hint='两指针分别走完 A+B 和 B+A。',complexity='时间 O(m+n)，空间 O(1)。')
add(206,'反转链表','reverse-linked-list','链表','reverseList','head','原地反转单链表的 next 指针并返回新表头。',[([[1,2,3,4,5]],[5,4,3,2,1]),([[]],[]),([[1]],[1])],'''
prev=None
while head:
    nxt=head.next;head.next=prev;prev=head;head=nxt
return prev
''',adapter='list0',hint='保存下一节点后再反转指针。',complexity='时间 O(n)，空间 O(1)。')
add(234,'回文链表','palindrome-linked-list','链表','isPalindrome','head','判断链表值序列是否从前往后与从后往前相同。',[([[1,2,2,1]],True),([[1,2]],False),([[1]],True)],'''
slow=fast=head
while fast and fast.next: slow=slow.next;fast=fast.next.next
prev=None
while slow: nxt=slow.next;slow.next=prev;prev=slow;slow=nxt
while prev:
    if head.val!=prev.val: return False
    head=head.next;prev=prev.next
return True
''',adapter='list0',hint='快慢指针定位中点，反转后半段比较。',complexity='时间 O(n)，空间 O(1)。')
add(141,'环形链表','linked-list-cycle','链表','hasCycle','head','判断链表是否存在环。输入：[值数组,尾节点连接的下标]，-1表示无环。',[([[3,2,0,-4],1],True),([[1],-1],False),([[], -1],False)],'''
slow=fast=head
while fast and fast.next:
    slow=slow.next;fast=fast.next.next
    if slow is fast: return True
return False
''',adapter='cycle',hint='快指针每次两步，慢指针每次一步。',complexity='时间 O(n)，空间 O(1)。')
add(142,'环形链表 II','linked-list-cycle-ii','链表','detectCycle','head','返回环入口节点。输入：[值数组,环入口下标]；本地输出入口下标，无环返回 None。',[([[3,2,0,-4],1],1),([[1],0],0),([[1,2],-1],None)],'''
slow=fast=head
while fast and fast.next:
    slow=slow.next;fast=fast.next.next
    if slow is fast:
        p=head
        while p is not slow: p=p.next;slow=slow.next
        return p
return None
''',adapter='cycleEntry',hint='相遇后让一个指针回到头部，两者同速前进。',complexity='时间 O(n)，空间 O(1)。')
add(21,'合并两个有序链表','merge-two-sorted-lists','链表','mergeTwoLists','list1, list2','合并两条非降序链表，返回非降序结果。',[([[1,2,4],[1,3,4]],[1,1,2,3,4,4]),([[],[]],[]),([[],[0]],[0])],'''
dummy=tail=ListNode()
while list1 and list2:
    if list1.val<=list2.val: tail.next=list1;list1=list1.next
    else: tail.next=list2;list2=list2.next
    tail=tail.next
tail.next=list1 or list2
return dummy.next
''',adapter='lists01',hint='哑节点简化头部处理。',complexity='时间 O(m+n)，空间 O(1)。')
add(2,'两数相加','add-two-numbers','链表','addTwoNumbers','l1, l2','两个非负整数按个位在前存于链表，返回同样表示法的和。',[([[2,4,3],[5,6,4]],[7,0,8]),([[0],[0]],[0]),([[9,9],[1]],[0,0,1])],'''
dummy=tail=ListNode();carry=0
while l1 or l2 or carry:
    total=carry+(l1.val if l1 else 0)+(l2.val if l2 else 0);carry=total//10
    tail.next=ListNode(total%10);tail=tail.next
    l1=l1.next if l1 else None;l2=l2.next if l2 else None
return dummy.next
''',adapter='lists01',hint='循环条件需要包含最后的进位。',complexity='时间 O(max(m,n))，输出空间 O(max(m,n))。')
add(19,'删除链表的倒数第 N 个结点','remove-nth-node-from-end-of-list','链表','removeNthFromEnd','head, n','删除链表倒数第 n 个节点并返回头部，n 合法。',[([[1,2,3,4,5],2],[1,2,3,5]),([[1],1],[]),([[1,2],2],[2])],'''
d=ListNode(0,head);fast=slow=d
for _ in range(n): fast=fast.next
while fast.next: fast=fast.next;slow=slow.next
slow.next=slow.next.next
return d.next
''',adapter='list0',hint='保持快慢指针相差 n 个位置。',complexity='时间 O(n)，空间 O(1)。')
add(24,'两两交换链表中的节点','swap-nodes-in-pairs','链表','swapPairs','head','通过改指针交换每对相邻节点，不交换节点值。',[([[1,2,3,4]],[2,1,4,3]),([[]],[]),([[1,2,3]],[2,1,3])],'''
d=ListNode(0,head);p=d
while p.next and p.next.next:
    a=p.next;b=a.next;a.next=b.next;b.next=a;p.next=b;p=a
return d.next
''',adapter='list0',hint='记录每一对之前的节点。',complexity='时间 O(n)，空间 O(1)。')
add(25,'K 个一组翻转链表','reverse-nodes-in-k-group','链表','reverseKGroup','head, k','每 k 个节点一组反转，末尾不足 k 个保持原样。',[([[1,2,3,4,5],2],[2,1,4,3,5]),([[1,2,3,4,5],3],[3,2,1,4,5]),([[1],1],[1])],'''
d=ListNode(0,head);before=d
while True:
    end=before
    for _ in range(k):
        end=end.next
        if not end: return d.next
    after=end.next;cur=before.next;prev=after;start=cur
    while cur is not after:
        nxt=cur.next;cur.next=prev;prev=cur;cur=nxt
    before.next=end;before=start
''',adapter='list0',hint='先确认有完整一组，再进行局部反转。',complexity='时间 O(n)，空间 O(1)。')
add(138,'随机链表的复制','copy-list-with-random-pointer','链表','copyRandomList','head','深复制带 next 和 random 指针的链表。输入为 [值,random下标或null] 的数组。',[([[[7,None],[13,0],[11,1]]],[[7,None],[13,0],[11,1]]),([[]],[]),([[[1,0]]],[[1,0]])],'''
mapping={None:None};p=head
while p: mapping[p]=Node(p.val);p=p.next
p=head
while p: mapping[p].next=mapping[p.next];mapping[p].random=mapping[p.random];p=p.next
return mapping[head]
''',adapter='random',hint='先创建节点映射，再连接两类指针。',complexity='时间 O(n)，空间 O(n)。')
add(148,'排序链表','sort-list','链表','sortList','head','将链表按节点值升序排列。',[([[4,2,1,3]],[1,2,3,4]),([[-1,5,3,4,0]],[-1,0,3,4,5]),([[]],[])],'''
def sort(h):
    if not h or not h.next: return h
    slow=h;fast=h.next
    while fast and fast.next: slow=slow.next;fast=fast.next.next
    right=slow.next;slow.next=None;a=sort(h);b=sort(right);d=t=ListNode()
    while a and b:
        if a.val<b.val: t.next=a;a=a.next
        else: t.next=b;b=b.next
        t=t.next
    t.next=a or b;return d.next
return sort(head)
''',adapter='list0',hint='用快慢指针切分并归并。',complexity='时间 O(n log n)，递归栈 O(log n)。')
add(23,'合并 K 个升序链表','merge-k-sorted-lists','链表','mergeKLists','lists','合并一组升序链表，返回一条升序链表。',[([[[1,4,5],[1,3,4],[2,6]]],[1,1,2,3,4,4,5,6]),([[]],[]),([[[],[1]]],[1])],'''
heap=[];counter=itertools.count()
for node in lists:
    if node: heapq.heappush(heap,(node.val,next(counter),node))
d=t=ListNode()
while heap:
    _,_,node=heapq.heappop(heap);t.next=node;t=node
    if node.next: heapq.heappush(heap,(node.next.val,next(counter),node.next))
return d.next
''',adapter='listArray',hint='最小堆保存每条链表当前头部，计数器避免节点比较。',complexity='N个节点、k条链表：时间 O(N log k)，空间 O(k)。')
add(146,'LRU 缓存','lru-cache','链表','LRUCache','','实现 get 与 put，容量满时淘汰最近最少使用的键。输入为 [操作名列表,参数列表]，构造和 put 输出 null。',[([['LRUCache','put','put','get','put','get'],[[2],[1,1],[2,2],[1],[3,3],[2]]],[None,None,None,1,None,-1]),([['LRUCache','put','put','get'],[[1],[1,1],[1,2],[1]]],[None,None,None,2]),([['LRUCache','get'],[[2],[9]]],[None,-1])],'''
class LRUCache:
    def __init__(self, capacity): self.capacity=capacity;self.d=OrderedDict()
    def get(self, key):
        if key not in self.d: return -1
        self.d.move_to_end(key);return self.d[key]
    def put(self, key, value):
        self.d[key]=value;self.d.move_to_end(key)
        if len(self.d)>self.capacity: self.d.popitem(last=False)
''',adapter='design',hint='哈希表配合双向顺序结构；OrderedDict 可验证语义。',complexity='get/put 平均 O(1)，空间 O(capacity)。')

# Trees
add(94,'二叉树的中序遍历','binary-tree-inorder-traversal','二叉树','inorderTraversal','root','按左子树、根、右子树顺序返回节点值。树使用层序数组，空节点为 null。',[([[1,None,2,3]],[1,3,2]),([[]],[]),([[1]],[1])],'''
out=[];stack=[]
while root or stack:
    while root: stack.append(root);root=root.left
    root=stack.pop();out.append(root.val);root=root.right
return out
''',adapter='tree0',hint='显式栈模拟递归返回路径。',complexity='时间 O(n)，空间 O(h)。')
add(104,'二叉树的最大深度','maximum-depth-of-binary-tree','二叉树','maxDepth','root','返回根到叶最长路径上的节点数。',[([[3,9,20,None,None,15,7]],3),([[]],0),([[1,None,2]],2)],'''
def depth(n): return 0 if not n else 1+max(depth(n.left),depth(n.right))
return depth(root)
''',adapter='tree0',complexity='时间 O(n)，空间 O(h)。')
add(226,'翻转二叉树','invert-binary-tree','二叉树','invertTree','root','交换每个节点的左右子树，返回根。',[([[4,2,7,1,3,6,9]],[4,7,2,9,6,3,1]),([[]],[]),([[1]],[1])],'''
def flip(n):
    if n: n.left,n.right=flip(n.right),flip(n.left)
    return n
return flip(root)
''',adapter='tree0',complexity='时间 O(n)，空间 O(h)。')
add(101,'对称二叉树','symmetric-tree','二叉树','isSymmetric','root','判断树的左右两部分是否互为镜像。',[([[1,2,2,3,4,4,3]],True),([[1,2,2,None,3,None,3]],False),([[1]],True)],'''
def mirror(a,b):
    if not a or not b: return a is b
    return a.val==b.val and mirror(a.left,b.right) and mirror(a.right,b.left)
return not root or mirror(root.left,root.right)
''',adapter='tree0',complexity='时间 O(n)，空间 O(h)。')
add(543,'二叉树的直径','diameter-of-binary-tree','二叉树','diameterOfBinaryTree','root','返回任意两节点最长路径的边数，该路径不一定经过根。',[([[1,2,3,4,5]],3),([[1]],0),([[1,2]],1)],'''
best=0
def depth(n):
    nonlocal best
    if not n: return 0
    l=depth(n.left);r=depth(n.right);best=max(best,l+r);return 1+max(l,r)
depth(root);return best
''',adapter='tree0',hint='向父节点返回单边深度，同时更新双边路径。',complexity='时间 O(n)，空间 O(h)。')
add(102,'二叉树的层序遍历','binary-tree-level-order-traversal','二叉树','levelOrder','root','按深度逐层返回节点值，每层从左到右。',[([[3,9,20,None,None,15,7]],[[3],[9,20],[15,7]]),([[]],[]),([[1]],[[1]])],'''
q=deque([root] if root else []);out=[]
while q:
    level=[]
    for _ in range(len(q)):
        n=q.popleft();level.append(n.val)
        if n.left:q.append(n.left)
        if n.right:q.append(n.right)
    out.append(level)
return out
''',adapter='tree0',complexity='时间 O(n)，空间 O(最大层宽)。')
add(108,'将有序数组转换为二叉搜索树','convert-sorted-array-to-binary-search-tree','二叉树','sortedArrayToBST','nums','从严格递增数组构造高度平衡的二叉搜索树。不同合法树形均可通过。',[([[-10,-3,0,5,9]],True),([[1,3]],True),([[0]],True)],'''
def build(l,r):
    if l>r:return None
    m=(l+r)//2;n=TreeNode(nums[m]);n.left=build(l,m-1);n.right=build(m+1,r);return n
return build(0,len(nums)-1)
''',adapter='balanced',hint='每次选择中点作为根。',complexity='时间 O(n)，除输出外空间 O(log n)。')
add(98,'验证二叉搜索树','validate-binary-search-tree','二叉树','isValidBST','root','严格二叉搜索树要求左子树所有值更小、右子树所有值更大。',[([[2,1,3]],True),([[5,1,4,None,None,3,6]],False),([[2,2,2]],False)],'''
def valid(n,lo,hi):
    if not n:return True
    return lo<n.val<hi and valid(n.left,lo,n.val) and valid(n.right,n.val,hi)
return valid(root,-math.inf,math.inf)
''',adapter='tree0',hint='把祖先形成的上下界向下传递。',complexity='时间 O(n)，空间 O(h)。')
add(230,'二叉搜索树中第 K 小的元素','kth-smallest-element-in-a-bst','二叉树','kthSmallest','root, k','返回二叉搜索树按升序计数的第 k 个值。',[([[3,1,4,None,2],1],1),([[5,3,6,2,4,None,None,1],3],3),([[1],1],1)],'''
stack=[]
while root or stack:
    while root:stack.append(root);root=root.left
    root=stack.pop();k-=1
    if k==0:return root.val
    root=root.right
''',adapter='tree0',complexity='时间 O(h+k)，空间 O(h)。')
add(199,'二叉树的右视图','binary-tree-right-side-view','二叉树','rightSideView','root','返回从右侧观察二叉树时每层可见的值。',[([[1,2,3,None,5,None,4]],[1,3,4]),([[]],[]),([[1,2]],[1,2])],'''
out=[]
def visit(n,d):
    if not n:return
    if d==len(out):out.append(n.val)
    visit(n.right,d+1);visit(n.left,d+1)
visit(root,0);return out
''',adapter='tree0',hint='优先访问右子树，记录每层首次遇到的节点。',complexity='时间 O(n)，空间 O(h)。')
add(114,'二叉树展开为链表','flatten-binary-tree-to-linked-list','二叉树','flatten','root','按前序顺序原地展开，全部 left 置空，right 指向下一节点。本地输出 right 链的值。',[([[1,2,5,3,4,None,6]],[1,2,3,4,5,6]),([[]],[]),([[0]],[0])],'''
cur=root
while cur:
    if cur.left:
        last=cur.left
        while last.right:last=last.right
        last.right=cur.right;cur.right=cur.left;cur.left=None
    cur=cur.right
''',adapter='flatten',hint='把左子树接到右侧，原右子树接到其最右节点之后。',complexity='时间 O(n)，空间 O(1)。')
add(105,'从前序与中序遍历序列构造二叉树','construct-binary-tree-from-preorder-and-inorder-traversal','二叉树','buildTree','preorder, inorder','节点值不重复，由前序和中序遍历重建二叉树。',[([[3,9,20,15,7],[9,3,15,20,7]],[3,9,20,None,None,15,7]),([[-1],[-1]],[-1]),([[1,2],[2,1]],[1,2])],'''
pos={v:i for i,v in enumerate(inorder)};idx=0
def build(l,r):
    nonlocal idx
    if l>r:return None
    v=preorder[idx];idx+=1;n=TreeNode(v);m=pos[v];n.left=build(l,m-1);n.right=build(m+1,r);return n
return build(0,len(inorder)-1)
''',hint='前序提供根，中序切分左右子树。',complexity='时间 O(n)，空间 O(n)。')
add(437,'路径总和 III','path-sum-iii','二叉树','pathSum','root, targetSum','统计向下连续路径中值之和为 targetSum 的路径数，不要求从根开始。',[([[10,5,-3,3,2,None,11,3,-2,None,1],8],3),([[1],1],1),([[0,0,0],0],5)],'''
counts={0:1}
def visit(n,s):
    if not n:return 0
    s+=n.val;ans=counts.get(s-targetSum,0);counts[s]=counts.get(s,0)+1
    ans+=visit(n.left,s)+visit(n.right,s);counts[s]-=1;return ans
return visit(root,0)
''',adapter='tree0',hint='DFS 路径上的前缀和计数，返回时撤销。',complexity='时间 O(n)，空间 O(h)。')
add(236,'二叉树的最近公共祖先','lowest-common-ancestor-of-a-binary-tree','二叉树','lowestCommonAncestor','root, p, q','在值互异的树中返回 p、q 的最近公共祖先。输入后两项是节点值，输出祖先值。',[([[3,5,1,6,2,0,8,None,None,7,4],5,1],3),([[3,5,1,6,2,0,8,None,None,7,4],5,4],5),([[1,2],1,2],1)],'''
def lca(n):
    if not n or n is p or n is q:return n
    a=lca(n.left);b=lca(n.right)
    return n if a and b else a or b
return lca(root)
''',adapter='lca',hint='左右各找到一个目标时，当前节点就是公共祖先。',complexity='时间 O(n)，空间 O(h)。')
add(124,'二叉树中的最大路径和','binary-tree-maximum-path-sum','二叉树','maxPathSum','root','求非空简单路径的最大节点和，路径可跨过一个转折点。',[([[1,2,3]],6),([[-10,9,20,None,None,15,7]],42),([[-3]],-3)],'''
best=-math.inf
def gain(n):
    nonlocal best
    if not n:return 0
    l=max(0,gain(n.left));r=max(0,gain(n.right));best=max(best,n.val+l+r);return n.val+max(l,r)
gain(root);return best
''',adapter='tree0',hint='向上只返回一条分支，负贡献舍弃。',complexity='时间 O(n)，空间 O(h)。')

add(200,'岛屿数量','number-of-islands','图论','numIslands','grid','字符矩阵中，四方向连接的 1 构成岛屿，统计岛屿数。',[([[['1','1','0'],['0','1','0'],['0','0','1']]],2),([[['0']]],0),([[['1']]],1)],'''
m=len(grid);n=len(grid[0]);ans=0
for r in range(m):
    for c in range(n):
        if grid[r][c]!='1':continue
        ans+=1;grid[r][c]='0';stack=[(r,c)]
        while stack:
            x,y=stack.pop()
            for a,b in [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]:
                if 0<=a<m and 0<=b<n and grid[a][b]=='1':grid[a][b]='0';stack.append((a,b))
return ans
''',hint='每找到一个未访问的陆地，就遍历并标记整个连通块。',complexity='时间 O(mn)，空间 O(mn)。')
add(994,'腐烂的橘子','rotting-oranges','图论','orangesRotting','grid','0为空，1为新鲜，2为腐烂。每分钟腐烂传到四邻居，求全部腐烂的最短时间，无法完成返回 -1。',[([[[2,1,1],[1,1,0],[0,1,1]]],4),([[[2,1,1],[0,1,1],[1,0,1]]],-1),([[[0,2]]],0)],'''
m=len(grid);n=len(grid[0]);q=deque();fresh=0;time=0
for r in range(m):
    for c in range(n):
        if grid[r][c]==2:q.append((r,c,0))
        if grid[r][c]==1:fresh+=1
while q:
    r,c,time=q.popleft()
    for a,b in [(r+1,c),(r-1,c),(r,c+1),(r,c-1)]:
        if 0<=a<m and 0<=b<n and grid[a][b]==1:grid[a][b]=2;fresh-=1;q.append((a,b,time+1))
return time if fresh==0 else -1
''',hint='从所有腐烂节点同时开始广度优先搜索。',complexity='时间与空间 O(mn)。')
add(207,'课程表','course-schedule','图论','canFinish','numCourses, prerequisites','先修关系 [a,b] 表示修 a 前必须修 b，判断能否完成全部课程。',[([2,[[1,0]]],True),([2,[[1,0],[0,1]]],False),([3,[]],True)],'''
g=[[] for _ in range(numCourses)];degree=[0]*numCourses
for a,b in prerequisites:g[b].append(a);degree[a]+=1
q=deque(i for i,d in enumerate(degree) if d==0);count=0
while q:
    v=q.popleft();count+=1
    for w in g[v]:
        degree[w]-=1
        if degree[w]==0:q.append(w)
return count==numCourses
''',hint='拓扑排序；如果处理节点数不足则有环。',complexity='时间 O(V+E)，空间 O(V+E)。')
add(208,'实现 Trie（前缀树）','implement-trie-prefix-tree','图论','Trie','','实现 insert(word)、search(word)、startsWith(prefix)。输入为操作名列表与参数列表。',[([['Trie','insert','search','search','startsWith'],[[],['apple'],['apple'],['app'],['app']]],[None,None,True,False,True]),([['Trie','search'],[[],['x']]],[None,False]),([['Trie','insert','insert','search'],[[],['a'],['ab'],['a']]],[None,None,None,True])],'''
class Trie:
    def __init__(self):self.root={}
    def insert(self, word):
        n=self.root
        for c in word:n=n.setdefault(c,{})
        n['#']=True
    def walk(self, text):
        n=self.root
        for c in text:
            if c not in n:return None
            n=n[c]
        return n
    def search(self, word):
        n=self.walk(word);return n is not None and '#' in n
    def startsWith(self, prefix):return self.walk(prefix) is not None
''',adapter='design',hint='结束标记区分完整单词与仅有前缀。',complexity='每次操作 O(字符串长度)。')

add(46,'全排列','permutations','回溯','permute','nums','互异整数数组，返回全部排列。',[([[1,2,3]],[[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]),([[0,1]],[[0,1],[1,0]]),([[1]],[[1]])],'''
out=[]
def dfs(path,rest):
    if not rest:out.append(path);return
    for i,x in enumerate(rest):dfs(path+[x],rest[:i]+rest[i+1:])
dfs([],nums);return out
''',compare='unordered',hint='每层选择一个尚未使用的元素。',complexity='时间 O(n·n!)，输出空间 O(n·n!)。')
add(78,'子集','subsets','回溯','subsets','nums','互异整数数组，返回所有子集，含空集。',[([[1,2]], [[],[1],[2],[1,2]]),([[0]],[[],[0]]),([[]],[[]])],'''
out=[[]]
for x in nums:out += [s+[x] for s in out]
return out
''',compare='groups',hint='每加入一个新元素，把已有子集复制并添加该元素。',complexity='时间和输出空间 O(n·2^n)。')
add(17,'电话号码的字母组合','letter-combinations-of-a-phone-number','回溯','letterCombinations','digits','按电话键盘2至9的字母映射，返回数字串对应的全部字母组合。',[(['23'],['ad','ae','af','bd','be','bf','cd','ce','cf']),([''],[]),(['2'],['a','b','c'])],'''
if not digits:return []
mapping={'2':'abc','3':'def','4':'ghi','5':'jkl','6':'mno','7':'pqrs','8':'tuv','9':'wxyz'};out=['']
for d in digits:out=[s+c for s in out for c in mapping[d]]
return out
''',compare='set',complexity='最坏时间 O(n·4^n)，空间随输出增长。')
add(39,'组合总和','combination-sum','回溯','combinationSum','candidates, target','互异正整数可以重复选用，返回和为 target 的所有不同组合。',[([[2,3,6,7],7],[[2,2,3],[7]]),([[2,3,5],8],[[2,2,2,2],[2,3,3],[3,5]]),([[2],1],[])],'''
candidates.sort();out=[]
def dfs(start,left,path):
    if left==0:out.append(path);return
    for i in range(start,len(candidates)):
        x=candidates[i]
        if x>left:break
        dfs(i,left-x,path+[x])
dfs(0,target,[]);return out
''',compare='groups',hint='递归保留当前下标允许重复，索引不回退避免排列重复。',complexity='回溯复杂度依赖目标值与最小候选数，输出可能指数增长。')
add(22,'括号生成','generate-parentheses','回溯','generateParenthesis','n','生成由 n 对括号构成的所有合法括号串。',[([3],['((()))','(()())','(())()','()(())','()()()']),([1],['()']),([2],['(())','()()'])],'''
out=[]
def dfs(s,l,r):
    if len(s)==2*n:out.append(s);return
    if l<n:dfs(s+'(',l+1,r)
    if r<l:dfs(s+')',l,r+1)
dfs('',0,0);return out
''',compare='set',hint='右括号数量不能超过已经放置的左括号数量。',complexity='结果数量为卡特兰数，时间 O(n·C_n)。')
add(79,'单词搜索','word-search','回溯','exist','board, word','在字符网格四方向路径中查找 word，同一次路径不能重复使用格子。',[([[['A','B','C','E'],['S','F','C','S'],['A','D','E','E']],'ABCCED'],True),([[['a']],'a'],True),([[['a','b']],'aba'],False)],'''
m=len(board);n=len(board[0]);used=set()
def dfs(r,c,i):
    if i==len(word):return True
    if not(0<=r<m and 0<=c<n) or (r,c) in used or board[r][c]!=word[i]:return False
    used.add((r,c));found=any(dfs(a,b,i+1) for a,b in [(r+1,c),(r-1,c),(r,c+1),(r,c-1)]);used.remove((r,c));return found
return any(dfs(r,c,0) for r in range(m) for c in range(n))
''',hint='路径访问标记在回溯时撤销。',complexity='最坏 O(mn·3^L)，空间 O(L)，L为单词长度。')
add(131,'分割回文串','palindrome-partitioning','回溯','partition','s','枚举把字符串切分为若干回文子串的全部方案。',[(['aab'],[['a','a','b'],['aa','b']]),(['a'],[['a']]),(['efe'],[['e','f','e'],['efe']])],'''
out=[]
def dfs(i,path):
    if i==len(s):out.append(path);return
    for j in range(i+1,len(s)+1):
        part=s[i:j]
        if part==part[::-1]:dfs(j,path+[part])
dfs(0,[]);return out
''',compare='unordered',hint='逐一尝试下一个回文前缀。',complexity='枚举最坏指数级；可预计算回文表降低重复判断。')
add(51,'N 皇后','n-queens','回溯','solveNQueens','n','在 n×n 棋盘放置 n 个皇后，使任意两个不同行、不同列、不同对角线。返回棋盘字符串数组。',[([4],[['.Q..','...Q','Q...','..Q.'],['..Q.','Q...','...Q','.Q..']]),([1],[['Q']]),([2],[])],'''
out=[];cols=set();d1=set();d2=set()
def dfs(r,path):
    if r==n:out.append(path);return
    for c in range(n):
        if c in cols or r-c in d1 or r+c in d2:continue
        cols.add(c);d1.add(r-c);d2.add(r+c)
        dfs(r+1,path+['.'*c+'Q'+'.'*(n-c-1)])
        cols.remove(c);d1.remove(r-c);d2.remove(r+c)
dfs(0,[]);return out
''',compare='unordered',hint='按行搜索，用列号、行列差、行列和判断冲突。',complexity='搜索上界 O(n!)，另计棋盘输出。')

add(35,'搜索插入位置','search-insert-position','二分查找','searchInsert','nums, target','在有序互异数组中找到 target 下标，若不存在返回保持有序的插入位置。',[([[1,3,5,6],5],2),([[1,3,5,6],2],1),([[1],2],1)],'''
l=0;r=len(nums)
while l<r:
    m=(l+r)//2
    if nums[m]<target:l=m+1
    else:r=m
return l
''',complexity='时间 O(log n)，空间 O(1)。')
add(74,'搜索二维矩阵','search-a-2d-matrix','二分查找','searchMatrix','matrix, target','每行递增，下一行首项大于上一行末项，判断是否包含 target。',[([[[1,3,5,7],[10,11,16,20],[23,30,34,60]],3],True),([[[1,3,5]],2],False),([[[1]],1],True)],'''
n=len(matrix[0]);l=0;r=len(matrix)*n-1
while l<=r:
    m=(l+r)//2;x=matrix[m//n][m%n]
    if x==target:return True
    if x<target:l=m+1
    else:r=m-1
return False
''',hint='把矩阵视为一维有序数组。',complexity='时间 O(log(mn))，空间 O(1)。')
add(34,'在排序数组中查找元素的第一个和最后一个位置','find-first-and-last-position-of-element-in-sorted-array','二分查找','searchRange','nums, target','返回目标值在非降序数组中的左右边界，不存在返回 [-1,-1]。',[([[5,7,7,8,8,10],8],[3,4]),([[5,7,7,8,8,10],6],[-1,-1]),([[],0],[-1,-1])],'''
l=bisect.bisect_left(nums,target);r=bisect.bisect_right(nums,target)-1
return [l,r] if l<=r else [-1,-1]
''',hint='分别找第一个不小于和第一个大于 target 的位置。',complexity='时间 O(log n)，空间 O(1)。')
add(33,'搜索旋转排序数组','search-in-rotated-sorted-array','二分查找','search','nums, target','互异有序数组经旋转后，查找目标下标，不存在返回 -1。',[([[4,5,6,7,0,1,2],0],4),([[4,5,6,7,0,1,2],3],-1),([[1],0],-1)],'''
l=0;r=len(nums)-1
while l<=r:
    m=(l+r)//2
    if nums[m]==target:return m
    if nums[l]<=nums[m]:
        if nums[l]<=target<nums[m]:r=m-1
        else:l=m+1
    else:
        if nums[m]<target<=nums[r]:l=m+1
        else:r=m-1
return -1
''',hint='每次二分至少有一半区间有序。',complexity='时间 O(log n)，空间 O(1)。')
add(153,'寻找旋转排序数组中的最小值','find-minimum-in-rotated-sorted-array','二分查找','findMin','nums','互异升序数组经过旋转，返回最小元素。',[([[3,4,5,1,2]],1),([[4,5,6,7,0,1,2]],0),([[1]],1)],'''
l=0;r=len(nums)-1
while l<r:
    m=(l+r)//2
    if nums[m]>nums[r]:l=m+1
    else:r=m
return nums[l]
''',complexity='时间 O(log n)，空间 O(1)。')
add(4,'寻找两个正序数组的中位数','median-of-two-sorted-arrays','二分查找','findMedianSortedArrays','nums1, nums2','两个非降序数组总体非空，返回合并后的中位数。',[([[1,3],[2]],2),([[1,2],[3,4]],2.5),([[],[1]],1)],'''
if len(nums1)>len(nums2):nums1,nums2=nums2,nums1
m=len(nums1);n=len(nums2);l=0;r=m
while l<=r:
    i=(l+r)//2;j=(m+n+1)//2-i
    a=nums1[i-1] if i else -math.inf;b=nums1[i] if i<m else math.inf
    c=nums2[j-1] if j else -math.inf;d=nums2[j] if j<n else math.inf
    if a<=d and c<=b:return max(a,c) if (m+n)%2 else (max(a,c)+min(b,d))/2
    if a>d:r=i-1
    else:l=i+1
''',hint='二分较短数组的分割点，使左侧数量固定且所有左值不大于右值。',complexity='时间 O(log min(m,n))，空间 O(1)。')

add(20,'有效的括号','valid-parentheses','栈','isValid','s','判断仅含三种括号的字符串是否正确配对并嵌套。',[(['()[]{}'],True),(['(]'],False),(['([)]'],False),(['{[]}'],True)],'''
stack=[];pairs={')':'(',']':'[','}':'{'}
for c in s:
    if c in pairs:
        if not stack or stack.pop()!=pairs[c]:return False
    else:stack.append(c)
return not stack
''',complexity='时间 O(n)，空间 O(n)。')
add(155,'最小栈','min-stack','栈','MinStack','','实现 push、pop、top、getMin，所有操作常数时间。输入操作列表与参数列表，pop 不返回值。',[([['MinStack','push','push','push','getMin','pop','top','getMin'],[[],[-2],[0],[-3],[],[],[],[]]],[None,None,None,None,-3,None,0,-2]),([['MinStack','push','getMin'],[[],[1],[]]],[None,None,1]),([['MinStack','push','push','pop','getMin'],[[],[0],[0],[],[]]],[None,None,None,None,0])],'''
class MinStack:
    def __init__(self):self.s=[]
    def push(self,val):self.s.append((val,min(val,self.s[-1][1]) if self.s else val))
    def pop(self):self.s.pop()
    def top(self):return self.s[-1][0]
    def getMin(self):return self.s[-1][1]
''',adapter='design',hint='每个栈元素同时记录截至该位置的最小值。',complexity='单次 O(1)，空间 O(n)。')
add(394,'字符串解码','decode-string','栈','decodeString','s','将 k[片段] 展开为重复 k 次的片段，支持嵌套和多位计数。',[(['3[a]2[bc]'],'aaabcbc'),(['3[a2[c]]'],'accaccacc'),(['10[a]'],'aaaaaaaaaa')],'''
stack=[];cur='';num=0
for c in s:
    if c.isdigit():num=num*10+int(c)
    elif c=='[':stack.append((cur,num));cur='';num=0
    elif c==']':prev,count=stack.pop();cur=prev+cur*count
    else:cur+=c
return cur
''',hint='左括号时保存外层状态，右括号时恢复并拼接。',complexity='受展开后输出长度影响，嵌套拼接可能重复复制字符。')
add(739,'每日温度','daily-temperatures','栈','dailyTemperatures','temperatures','对每一天返回要等几天才有更高温度，之后没有更高温度则为0。',[([[73,74,75,71,69,72,76,73]],[1,1,4,2,1,1,0,0]),([[30,40,50,60]],[1,1,1,0]),([[30,30]],[0,0])],'''
out=[0]*len(temperatures);stack=[]
for i,t in enumerate(temperatures):
    while stack and temperatures[stack[-1]]<t:
        j=stack.pop();out[j]=i-j
    stack.append(i)
return out
''',hint='单调栈保存尚未找到更高温度的日期。',complexity='时间 O(n)，空间 O(n)。')
add(84,'柱状图中最大的矩形','largest-rectangle-in-histogram','栈','largestRectangleArea','heights','单位宽度柱状图中，求由连续柱子形成的最大矩形面积。',[([[2,1,5,6,2,3]],10),([[2,4]],4),([[2,2]],4),([[0]],0)],'''
stack=[];ans=0;a=[0]+heights+[0]
for i,h in enumerate(a):
    while stack and a[stack[-1]]>h:
        height=a[stack.pop()];width=i-stack[-1]-1;ans=max(ans,height*width)
    stack.append(i)
return ans
''',hint='弹出高度时，当前下标和新栈顶构成它的左右更矮边界。',complexity='时间 O(n)，空间 O(n)。')
add(215,'数组中的第 K 个最大元素','kth-largest-element-in-an-array','堆','findKthLargest','nums, k','按降序计数返回第 k 个元素，重复元素计入名次。',[([[3,2,1,5,6,4],2],5),([[3,2,3,1,2,4,5,5,6],4],4),([[1],1],1)],'''
heap=[]
for x in nums:
    if len(heap)<k:heapq.heappush(heap,x)
    elif x>heap[0]:heapq.heapreplace(heap,x)
return heap[0]
''',hint='大小为 k 的最小堆保留最大的 k 个元素。',complexity='时间 O(n log k)，空间 O(k)。')
add(347,'前 K 个高频元素','top-k-frequent-elements','堆','topKFrequent','nums, k','返回出现频率最高的 k 个不同元素，保证答案唯一，顺序不限。',[([[1,1,1,2,2,3],2],[1,2]),([[1],1],[1]),([[4,4,4,5,5,6],1],[4])],'''
counts=Counter(nums);buckets=[[] for _ in range(len(nums)+1)]
for x,count in counts.items():buckets[count].append(x)
out=[]
for bucket in reversed(buckets):
    out.extend(bucket)
    if len(out)>=k:return out[:k]
''',compare='set',hint='频次上界为数组长度，可以使用桶。',complexity='时间和空间 O(n)。')
add(295,'数据流的中位数','find-median-from-data-stream','堆','MedianFinder','','实现 addNum 与 findMedian，查询时至少有一个元素。输入操作名列表和参数列表。',[([['MedianFinder','addNum','addNum','findMedian','addNum','findMedian'],[[],[1],[2],[],[3],[]]],[None,None,None,1.5,None,2]),([['MedianFinder','addNum','findMedian'],[[],[-1],[]]],[None,None,-1]),([['MedianFinder','addNum','addNum','findMedian'],[[],[0],[0],[]]],[None,None,None,0])],'''
class MedianFinder:
    def __init__(self):self.lo=[];self.hi=[]
    def addNum(self,num):
        heapq.heappush(self.lo,-num);heapq.heappush(self.hi,-heapq.heappop(self.lo))
        if len(self.hi)>len(self.lo):heapq.heappush(self.lo,-heapq.heappop(self.hi))
    def findMedian(self):return -self.lo[0] if len(self.lo)>len(self.hi) else (-self.lo[0]+self.hi[0])/2
''',adapter='design',hint='最大堆维护较小半边，最小堆维护较大半边。',complexity='插入 O(log n)，查询 O(1)，空间 O(n)。')

add(121,'买卖股票的最佳时机','best-time-to-buy-and-sell-stock','贪心算法','maxProfit','prices','最多完成一次先买后卖，求最大利润，可不交易。',[([[7,1,5,3,6,4]],5),([[7,6,4,3,1]],0),([[1]],0)],'''
low=math.inf;best=0
for p in prices:low=min(low,p);best=max(best,p-low)
return best
''',complexity='时间 O(n)，空间 O(1)。')
add(55,'跳跃游戏','jump-game','贪心算法','canJump','nums','每个位置的非负值表示最大向前跳跃长度，判断能否从起点到末尾。',[([[2,3,1,1,4]],True),([[3,2,1,0,4]],False),([[0]],True)],'''
far=0
for i,x in enumerate(nums):
    if i>far:return False
    far=max(far,i+x)
return True
''',hint='维护所有已达位置可扩展的最远边界。',complexity='时间 O(n)，空间 O(1)。')
add(45,'跳跃游戏 II','jump-game-ii','贪心算法','jump','nums','保证可到达末尾，求从起点到末尾的最少跳跃次数。',[([[2,3,1,1,4]],2),([[2,3,0,1,4]],2),([[0]],0)],'''
end=far=steps=0
for i in range(len(nums)-1):
    far=max(far,i+nums[i])
    if i==end:steps+=1;end=far
return steps
''',hint='当前一跳能覆盖的区间结束时才增加步数。',complexity='时间 O(n)，空间 O(1)。')
add(763,'划分字母区间','partition-labels','贪心算法','partitionLabels','s','尽量多地切分字符串，使每个字符只出现在其中一段，返回各段长度。',[(['ababcbacadefegdehijhklij'],[9,7,8]),(['eccbbbbdec'],[10]),(['abc'],[1,1,1])],'''
last={c:i for i,c in enumerate(s)};end=start=0;out=[]
for i,c in enumerate(s):
    end=max(end,last[c])
    if i==end:out.append(i-start+1);start=i+1
return out
''',hint='用当前已见字符最晚出现位置确定区间结束点。',complexity='时间 O(n)，空间 O(字符集大小)。')
add(70,'爬楼梯','climbing-stairs','动态规划','climbStairs','n','每次爬1阶或2阶，求爬到正整数 n 阶的不同方法数。',[([2],2),([3],3),([1],1),([5],8)],'''
a=b=1
for _ in range(n):a,b=b,a+b
return a
''',complexity='时间 O(n)，空间 O(1)。')
add(118,'杨辉三角','pascals-triangle','动态规划','generate','numRows','生成指定行数的杨辉三角，边缘为1，内部为上一行相邻两数之和。',[([5],[[1],[1,1],[1,2,1],[1,3,3,1],[1,4,6,4,1]]),([1],[[1]]),([2],[[1],[1,1]])],'''
out=[]
for i in range(numRows):
    row=[1]*(i+1)
    for j in range(1,i):row[j]=out[-1][j-1]+out[-1][j]
    out.append(row)
return out
''',complexity='时间和输出空间 O(n²)。')
add(198,'打家劫舍','house-robber','动态规划','rob','nums','从非负数组中选择不相邻元素，求最大总和。',[([[1,2,3,1]],4),([[2,7,9,3,1]],12),([[2,1,1,2]],4)],'''
a=b=0
for x in nums:a,b=b,max(b,a+x)
return b
''',hint='当前位置的最优值来自跳过它或选它加前前项最优值。',complexity='时间 O(n)，空间 O(1)。')
add(279,'完全平方数','perfect-squares','动态规划','numSquares','n','正整数 n 最少需要多少个完全平方数相加表示，可重复使用。',[([12],3),([13],2),([1],1)],'''
dp=[0]+[n+1]*n
for i in range(1,n+1):
    for j in range(1,math.isqrt(i)+1):dp[i]=min(dp[i],dp[i-j*j]+1)
return dp[n]
''',complexity='时间 O(n√n)，空间 O(n)。')
add(322,'零钱兑换','coin-change','动态规划','coinChange','coins, amount','硬币面额均为正数且可无限使用，求凑成 amount 的最少硬币数，不能凑成返回-1。',[([[1,2,5],11],3),([[2],3],-1),([[1],0],0)],'''
dp=[0]+[amount+1]*amount
for x in range(1,amount+1):
    for coin in coins:
        if coin<=x:dp[x]=min(dp[x],dp[x-coin]+1)
return dp[amount] if dp[amount]<=amount else -1
''',complexity='时间 O(amount·面额数)，空间 O(amount)。')
add(139,'单词拆分','word-break','动态规划','wordBreak','s, wordDict','判断字符串能否由词典中的单词连接而成，同一单词可以多次使用。',[(['leetcode',['leet','code']],True),(['applepenapple',['apple','pen']],True),(['catsandog',['cats','dog','sand','and','cat']],False)],'''
words=set(wordDict);dp=[True]+[False]*len(s)
for i in range(1,len(s)+1):
    dp[i]=any(dp[j] and s[j:i] in words for j in range(i))
return dp[-1]
''',hint='dp[i] 表示前 i 个字符能否拆分。',complexity='O(n²) 次转移，Python 子串复制使最坏字符处理达到 O(n³)。')
add(300,'最长递增子序列','longest-increasing-subsequence','动态规划','lengthOfLIS','nums','返回严格递增子序列的最长长度，所选位置不要求连续。',[([[10,9,2,5,3,7,101,18]],4),([[0,1,0,3,2,3]],4),([[7,7,7]],1)],'''
tails=[]
for x in nums:
    i=bisect.bisect_left(tails,x)
    if i==len(tails):tails.append(x)
    else:tails[i]=x
return len(tails)
''',hint='维护每种长度递增子序列可能的最小末尾值。',complexity='时间 O(n log n)，空间 O(n)。')
add(152,'乘积最大子数组','maximum-product-subarray','动态规划','maxProduct','nums','求非空连续子数组的最大乘积。',[([[2,3,-2,4]],6),([[-2,0,-1]],0),([[-2,3,-4]],24)],'''
lo=hi=best=nums[0]
for x in nums[1:]:lo,hi=min(x,lo*x,hi*x),max(x,lo*x,hi*x);best=max(best,hi)
return best
''',hint='负数可能把最小乘积变成最大，因此同时保留两者。',complexity='时间 O(n)，空间 O(1)。')
add(416,'分割等和子集','partition-equal-subset-sum','动态规划','canPartition','nums','正整数数组能否分为两个元素和相同的子集，每个元素使用一次。',[([[1,5,11,5]],True),([[1,2,3,5]],False),([[1,1]],True)],'''
total=sum(nums)
if total%2:return False
target=total//2;dp=[True]+[False]*target
for x in nums:
    for t in range(target,x-1,-1):dp[t]=dp[t] or dp[t-x]
return dp[target]
''',hint='转为容量为总和一半的0/1背包，倒序更新。',complexity='时间 O(n·sum)，空间 O(sum)。')
add(32,'最长有效括号','longest-valid-parentheses','动态规划','longestValidParentheses','s','仅由左右括号组成，返回最长合法连续括号子串的长度。',[(['(()'],2),([')()())'],4),([''],0),(['()(())'],6)],'''
stack=[-1];best=0
for i,c in enumerate(s):
    if c=='(':stack.append(i)
    else:
        stack.pop()
        if not stack:stack.append(i)
        else:best=max(best,i-stack[-1])
return best
''',hint='栈底记录当前合法段之前的边界。',complexity='时间 O(n)，空间 O(n)。')
add(62,'不同路径','unique-paths','多维动态规划','uniquePaths','m, n','从 m×n 网格左上走到右下，每步只能向右或向下，求路径数。',[([3,7],28),([3,2],3),([1,1],1)],'''
dp=[1]*n
for _ in range(m-1):
    for j in range(1,n):dp[j]+=dp[j-1]
return dp[-1]
''',complexity='时间 O(mn)，空间 O(n)。')
add(64,'最小路径和','minimum-path-sum','多维动态规划','minPathSum','grid','从非负矩阵左上走到右下，只能向右或向下，求经过值的最小总和。',[([[[1,3,1],[1,5,1],[4,2,1]]],7),([[[1,2,3],[4,5,6]]],12),([[[0]]],0)],'''
n=len(grid[0]);dp=[math.inf]*n;dp[0]=0
for row in grid:
    for j,x in enumerate(row):dp[j]=x+min(dp[j],dp[j-1] if j else math.inf)
return dp[-1]
''',complexity='时间 O(mn)，空间 O(n)。')
add(5,'最长回文子串','longest-palindromic-substring','多维动态规划','longestPalindrome','s','返回最长连续回文子串；若有多个相同最长长度答案，任意一个均可。',[(['babad'],3),(['cbbd'],2),(['a'],1),(['aaaa'],4)],'''
best=''
for center in range(len(s)):
    for l,r in [(center,center),(center,center+1)]:
        while l>=0 and r<len(s) and s[l]==s[r]:
            if r-l+1>len(best):best=s[l:r+1]
            l-=1;r+=1
return best
''',compare='palindrome',hint='分别枚举奇数与偶数长度的中心。',complexity='时间 O(n²)，子串更新会产生复制；辅助索引可优化至 O(1)。')
add(1143,'最长公共子序列','longest-common-subsequence','多维动态规划','longestCommonSubsequence','text1, text2','返回两个字符串最长公共子序列长度，字符不必连续但保持顺序。',[(['abcde','ace'],3),(['abc','abc'],3),(['abc','def'],0)],'''
dp=[0]*(len(text2)+1)
for a in text1:
    prev=0
    for j,b in enumerate(text2,1):
        old=dp[j];dp[j]=prev+1 if a==b else max(dp[j],dp[j-1]);prev=old
return dp[-1]
''',hint='字符相同继承左上状态，否则取删去一个末尾后的较大值。',complexity='时间 O(mn)，空间 O(n)。')
add(72,'编辑距离','edit-distance','多维动态规划','minDistance','word1, word2','插入、删除、替换各花费1，求将 word1 转换成 word2 的最少操作数。',[(['horse','ros'],3),(['intention','execution'],5),(['','abc'],3)],'''
dp=list(range(len(word2)+1))
for i,a in enumerate(word1,1):
    prev=dp[0];dp[0]=i
    for j,b in enumerate(word2,1):
        old=dp[j];dp[j]=prev if a==b else 1+min(prev,dp[j],dp[j-1]);prev=old
return dp[-1]
''',complexity='时间 O(mn)，空间 O(n)。')
add(136,'只出现一次的数字','single-number','技巧','singleNumber','nums','数组中一个值出现一次，其余值都出现两次，返回单次值。',[([[2,2,1]],1),([[4,1,2,1,2]],4),([[1]],1)],'''
value=0
for x in nums:value^=x
return value
''',hint='异或满足 x xor x = 0。',complexity='时间 O(n)，空间 O(1)。')
add(169,'多数元素','majority-element','技巧','majorityElement','nums','保证某个值出现次数超过数组长度一半，返回该值。',[([[3,2,3]],3),([[2,2,1,1,1,2,2]],2),([[1]],1)],'''
candidate=None;votes=0
for x in nums:
    if votes==0:candidate=x
    votes+=1 if x==candidate else -1
return candidate
''',hint='不同元素两两抵消，多数元素仍会留下。',complexity='时间 O(n)，空间 O(1)。')
add(75,'颜色分类','sort-colors','技巧','sortColors','nums','数组仅含0、1、2，原地排序，不调用排序函数。',[([[2,0,2,1,1,0]],[0,0,1,1,2,2]),([[2,0,1]],[0,1,2]),([[1]],[1])],'''
l=i=0;r=len(nums)-1
while i<=r:
    if nums[i]==0:nums[l],nums[i]=nums[i],nums[l];l+=1;i+=1
    elif nums[i]==2:nums[r],nums[i]=nums[i],nums[r];r-=1
    else:i+=1
''',adapter='inplace',hint='三段划分；交换来未知的尾元素时不要前进扫描指针。',complexity='时间 O(n)，空间 O(1)。')
add(31,'下一个排列','next-permutation','技巧','nextPermutation','nums','原地得到字典序下一个排列，若已最大则变为最小排列。',[([[1,2,3]],[1,3,2]),([[3,2,1]],[1,2,3]),([[1,1,5]],[1,5,1]),([[1,3,2]],[2,1,3])],'''
i=len(nums)-2
while i>=0 and nums[i]>=nums[i+1]:i-=1
if i>=0:
    j=len(nums)-1
    while nums[j]<=nums[i]:j-=1
    nums[i],nums[j]=nums[j],nums[i]
l=i+1;r=len(nums)-1
while l<r:nums[l],nums[r]=nums[r],nums[l];l+=1;r-=1
''',adapter='inplace',hint='找到最右上升拐点，与后缀中略大者交换，再反转后缀。',complexity='时间 O(n)，空间 O(1)。')
add(287,'寻找重复数','find-the-duplicate-number','技巧','findDuplicate','nums','长度 n+1 的数组取值1至n，恰有一个重复值，可重复多次；不修改数组并用常数空间找出它。',[([[1,3,4,2,2]],2),([[3,1,3,4,2]],3),([[2,2,2,2,2]],2)],'''
slow=fast=0
while True:
    slow=nums[slow];fast=nums[nums[fast]]
    if slow==fast:break
p=0
while p!=slow:p=nums[p];slow=nums[slow]
return p
''',hint='把下标到值看成有向边，重复值对应环入口。',complexity='时间 O(n)，空间 O(1)。')

if __name__=='__main__':
    rules={
      1:'nums 至少有两个整数；存在且仅存在一组下标答案，不能重复使用同一个位置。',49:'strs 为小写英文字母字符串数组，允许空字符串和重复项；组内与组间顺序均不限。',128:'nums 为整数数组，可为空且可含重复值；要求平均 O(n) 时间。',283:'nums 为整数数组；必须修改传入数组，保持非零元素的原有顺序。',11:'height 至少包含两个非负高度；两条边必须来自不同下标。',15:'nums 为整数数组；三元组使用不同下标；输出不得包含重复三元组。',42:'height 是非负整数柱高数组；柱宽为 1。',3:'s 是字符串；子串要求连续，以字符为单位计数。',438:'s 和 p 由小写英文字母组成，p 非空；返回匹配窗口的起始下标。',560:'nums 为整数数组，可含负数和零；k 为整数，子数组必须非空且连续。',239:'nums 非空，窗口大小满足 1 ≤ k ≤ len(nums)。',76:'s 和 t 为字符串，大小写不同；必须包含 t 中每个字符的重复次数。',53:'nums 为非空整数数组；子数组必须非空且连续。',56:'每个区间为 [start,end] 且 start ≤ end；端点重叠也需要合并。',189:'nums 非空，k 为非负整数，可大于数组长度；必须原地修改。',238:'nums 至少两个整数；输出为除当前下标外其他元素的乘积；不能使用除法。',41:'nums 为整数数组；目标是未出现的最小正整数，要求 O(n) 时间与常数额外空间。',73:'matrix 为矩形整数矩阵；按修改前的零确定需要清零的行列，原地修改。',54:'matrix 为非空矩形矩阵；每个位置恰好访问一次。',48:'matrix 为 n×n 方阵；原地顺时针旋转，不返回新矩阵。',240:'matrix 每行从左到右递增、每列从上到下递增；返回布尔值。',160:'参数为两个不共享前缀和一个共享尾部数组；相交按节点身份判断，不能只比较数值。',206:'链表为有限无环单链表，可为空；返回反转后的头节点。',234:'链表有限且无环；比较节点值是否构成回文。',141:'参数为节点值数组和 pos；pos=-1 表示无环，否则尾部指向该下标的原节点。',142:'参数与环形链表一致；返回环入口的原节点，不能返回同值的新节点。',21:'两条链表均按非递减顺序排列，可为空；结果也需有序。',2:'两条非空链表按逆序存储十进制数字，每个节点值为 0–9。',19:'链表非空，1 ≤ n ≤ 链表长度；删除倒数第 n 个节点。',24:'链表有限无环，可为空；必须交换节点位置，末尾单节点保留。',25:'1 ≤ k ≤ 链表长度；不足 k 个的末尾节点保持原顺序。',138:'输入为 [值,random下标或null] 数组；新链表不能引用原节点。',148:'链表有限无环；返回按节点值非递减排列的链表。',23:'输入为多个有序链表的值数组，允许空链表；结果合并后非递减。',146:'capacity 为正整数；get 未找到返回 -1；get/put 都更新最近使用顺序。',94:'二叉树使用层序数组，null 代表空节点；返回中序遍历的值数组。',104:'二叉树可为空；空树深度为 0，以节点层数计深度。',226:'二叉树可为空；对每个节点交换左右子树。',101:'二叉树可为空；对称同时要求结构与对应节点值相同。',543:'二叉树路径可不经过根；直径按边数计算。',102:'二叉树可为空；输出逐层值数组，空树返回 []。',108:'nums 严格递增；可返回任意合法的高度平衡二叉搜索树。',98:'二叉搜索树的左子树值严格小于根，右子树值严格大于根，不允许相等。',230:'输入为合法二叉搜索树；1 ≤ k ≤ 节点数。',199:'返回从右侧观察时每层最右节点；空树返回 []。',114:'原地转换为先序链表，使用 right 串联，所有 left 必须为空。',105:'先序与中序包含相同的互异节点值，且能唯一确定二叉树。',437:'路径沿父到子向下，允许从任意节点开始和结束；节点值可为负。',236:'节点值互异，p、q 均存在于树中；节点可以是它自身的祖先。',124:'树非空；路径至少包含一个节点，不可重复经过节点。',200:'grid 为矩形字符数组，元素为 "0" 或 "1"；仅上下左右相邻。',994:'grid 为矩形整数数组，0为空、1为新鲜、2为腐烂；每分钟影响四邻。',207:'课程编号为 0 至 numCourses-1；[a,b] 表示学习 a 前要完成 b。',208:'操作包含 Trie、insert、search、startsWith；插入/查询词由小写英文字母组成。',46:'nums 中元素互异；每个排列包含所有元素且不重复。',78:'nums 中元素互异；输出所有子集，包括空集，不重复。',17:'digits 仅包含 2–9，空输入返回空列表。',39:'candidates 为互异正整数，target 为正整数；同一数字允许重复使用。',22:'n 为正整数；生成含 n 对括号的全部合法组合。',79:'board 为字符矩形，word 非空；仅四邻移动，同一路径不能重复使用格子。',131:'s 非空；切分片段必须连续、覆盖全文，并且每段是回文。',51:'n 为正整数；每行列各一后，任何两后不能位于同一对角线。',35:'nums 严格递增，target 为整数；返回匹配或保持顺序的插入下标。',74:'每行非递减且下一行首元素大于上一行末元素。',34:'nums 非递减，可为空；不存在目标返回 [-1,-1]，要求 O(log n)。',33:'nums 是互异递增数组旋转后的结果；找不到返回 -1。',153:'nums 为非空互异递增数组的旋转结果；要求 O(log n)。',4:'两个数组各自非递减，总长度大于 0；偶数长度返回中间两值的平均数。',20:'s 仅包含 ()[]{}；闭合类型和嵌套顺序必须正确。',155:'pop/top/getMin 只在非空栈调用；getMin 返回当前栈中最小值。',394:'编码中的重复次数为正整数，括号合法嵌套；数字只表示重复次数。',739:'temperatures 为温度数组；必须找到严格更高的后续温度，否则返回 0。',84:'heights 为非负整数，柱宽均为 1；矩形必须由连续柱组成。',215:'nums 非空，1 ≤ k ≤ len(nums)；重复值参与排名。',347:'1 ≤ k ≤ 不同元素个数；返回频率最高的 k 个值，答案唯一，顺序不限。',295:'操作包含 MedianFinder、addNum、findMedian；查询时至少已有一个数字。',121:'prices 非空；最多买卖各一次且先买后卖，无获利返回 0。',55:'nums 非空且元素非负；每个值是当前位置的最大跳跃长度。',45:'nums 非空且元素非负，保证能到末尾；求最少跳跃次数。',763:'s 由小写英文字母组成；同一字符的所有出现必须位于同一段。',70:'n 为正整数；每步可以走 1 或 2 级。',118:'numRows 为正整数；返回从第一行开始的指定行数。',198:'nums 为非负金额数组；不能选择相邻位置。',279:'n 为正整数；每个加数必须是正整数的平方，可重复。',322:'coins 为正整数面额，amount 为非负整数；每种硬币可用无限次。',139:'s 非空，wordDict 为非空单词集合；单词可重复使用，必须覆盖整串。',300:'nums 为整数数组；子序列可不连续，但必须严格递增。',152:'nums 为非空整数数组；子数组必须连续且非空，需处理负数和零。',416:'nums 为正整数数组；每个元素只能使用一次，划分成两个等和子集。',32:'s 仅包含左右圆括号；寻找连续合法括号子串的最大长度。',62:'m、n 为正整数；只可向右或向下移动。',64:'grid 为非空非负矩形矩阵；只可向右或向下，路径包含起终点。',5:'s 非空；返回任意一个最长的连续回文子串。',1143:'两个输入为字符串；子序列保持顺序但可以不连续。',72:'每次操作可以插入、删除或替换一个字符；允许空串。',136:'nums 非空，除一个元素出现一次外，其他元素均出现两次。',169:'nums 非空，保证有一个值出现次数严格大于 len(nums)/2。',75:'nums 只含整数 0、1、2；必须原地修改。',31:'nums 非空，可包含重复值；原地修改为字典序下一个排列。',287:'数组长度 n+1，元素在 1..n；仅有一个重复值，可以出现多次，不能修改输入。',
    }
    assert len(rules)==100 and all(p['id'] in rules for p in problems)
    for p in problems:
        if p['id']==41:p['difficulty']='困难'
        p['constraints']=rules[p['id']]+' 数值范围与平台完整约束请核对力扣原题。'
    assert len(problems)==100,(len(problems),[p['id'] for p in problems])
    assert len({p['id'] for p in problems})==100
    out=ROOT/'content';out.mkdir(exist_ok=True)
    (out/'problems.json').write_text(json.dumps(problems,ensure_ascii=False,indent=2),encoding='utf8')
    print('Wrote',len(problems),'problems')
