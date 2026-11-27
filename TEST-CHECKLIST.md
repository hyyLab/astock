# Bayes 战法权重系统：独立逻辑测试清单

> 测试对象：`hyyLab/astock` 仓库 `feat/postgres-shadow-tables` 分支。
> 基线提交：`463920ec404cc9371db6937b569ea0adc319e8b1`。
> 本清单供没有仓库运行环境的独立测试者使用：所有用例均可通过代码走查、公式代入和手算核对。数值允许误差见各用例。
>
> **重要：** 本清单是测试规格，不代表这些测试已经执行或通过。执行者应先确认当前分支包含基线提交及本清单提交。

## 0. 通用约定

- 比例、概率均使用 `0..1`，不是百分数。
- FDR 默认 `q=0.10`、先验 `Beta(1,1)`、`minN=5`。
- HDI 默认可信质量 `credMass=0.9`。
- 权重向量按战法顺序排列，分量之和应为 1。
- 数值核对建议：普通后验/概率误差不超过 `1e-6`；HDI 端点误差不超过 `1e-6`；浮点计算允许末位舍入差异。
- 以下模块路径均相对于仓库根目录。

---

## 1. HDI 数值工具

文件：`src/lib/bayes/hdi.ts`

### HDI-01：均匀 Beta 的 90% HDI（硬性自检）

- **输入：** `betaHdi(1, 1, 0.9)`
- **期望：** `[0.05, 0.95]`，两个端点误差均不超过 `1e-6`。
- **核对：** 均匀密度下，任意长度 0.9 的区间概率均为 0.9；实现对称化后必须精确返回这两个端点。
- **代码位置：** `hdi.ts / betaHdi`、`hdi.ts / runHdiSelfChecks`；`hdi.ts` 模块末尾的自检调用。直接导入 `hdi.ts` 会触发自检；导入 `assemble.ts` 等经由 `hdi.ts` 的模块同样会触发（装配层不再重复调用）。

### HDI-02：偏斜 Beta(2,5) 的 90% HDI

- **输入：** `betaHdi(2, 5, 0.9)`
- **期望：** `lower = 0.0301508644`，`upper = 0.5252886427`；端点误差各不超过 `1e-6`。
- **性质核对：**
  - 区间包含 90% 的 Beta(2,5) 概率质量。
  - 内部最优区间两端的 Beta 概率密度相等（数值误差允许约 `1e-5`）。
  - 下端明显小于 0.1，不能把 HDI 错当成等尾区间。
- **参考手算关系：** `I_upper(2,5) - I_lower(2,5) = 0.9`，且 `f( lower ) = f( upper )`。
- **代码位置：** `hdi.ts / betaHdi`、`hdi.ts / inverseBetaCdf`；不完全 Beta CDF 在 `fdr.ts / regularizedBeta`。

### HDI-03：非法参数必须拒绝

- **输入：** 依次测试 `betaHdi(0, 2)`、`betaHdi(2, -1)`、`betaHdi(2, 5, 1)`。
- **期望：** 每次均抛出 `Invalid beta HDI parameters`，不能返回 NaN、越界区间或静默默认值。
- **代码位置：** `hdi.ts / betaHdi` 参数校验。

### HDI-04：CDF 反函数单调性

- **输入：** 固定 `alpha=2,beta=5`，分别求 `inverseBetaCdf(0.1,2,5)`、`inverseBetaCdf(0.5,2,5)`、`inverseBetaCdf(0.9,2,5)`。
- **期望：** 三个结果严格递增，均在 `(0,1)`；代回 `regularizedBeta(x,2,5)` 后分别得到 0.1、0.5、0.9，误差不超过 `1e-6`。
- **代码位置：** `hdi.ts / inverseBetaCdf`；`fdr.ts / regularizedBeta`。

### HDI-05：regularizedBeta 故障注入——导入 hdi.ts 必须抛错

- **测试方法（故障注入走查）：**
  1. 临时把 `fdr.ts / regularizedBeta` 替换为注入实现，两种注入分别独立测试：
     - 常数注入：函数体直接 `return 0.5;`（忽略入参）；
     - NaN 注入：函数体直接 `return NaN;`。
  2. 注入生效期间，运行一个只做 `import "./src/lib/bayes/hdi";` 的入口脚本（等价于以任意方式加载 `hdi.ts` 模块）。
  3. 每种注入记录模块加载结果，然后恢复原代码。
- **期望：** 两种注入下 `hdi.ts` 模块加载都必须抛错（Uniform Beta(1,1) 或 Beta(2,5) 自检失败之一），不允许静默加载成功。若自检断言缺少 `Number.isFinite` 防护，端点为 NaN 时 `Math.abs(NaN-参考值)>1e-6` 恒为 false，自检会静默通过。
- **代码位置：** `hdi.ts / runHdiSelfChecks` 的 `!Number.isFinite(...)` 防护与参考常数断言；被注入的 `fdr.ts / regularizedBeta`；`hdi.ts` 模块末尾的自检调用。

---

## 2. 经验贝叶斯先验

文件：`src/lib/bayes/empirical-prior.ts`

### EP-01：P1 回归——postMean 边界口径统一为 (0,1)

- **输入：** 构造一个 `EmpiricalPriorResult`，其中两个 bucket 分别为：
  - `{id:"low", wins:0, n:100, observedRate:0, lambda:0.1, postMean:0.001, includedInPriorFit:true}`
  - `{id:"high", wins:100, n:100, observedRate:1, lambda:0.1, postMean:0.999, includedInPriorFit:true}`
  - 结果对象其余数值字段给合法有限值，`completeShrinkage:false`。
- **调用：** `runEmpiricalPriorSelfChecks(result)`，不传 minMu/maxMu。
- **期望：** 不抛出 `postMean out of bounds`。默认检查边界为 0 和 1；0.001、0.999 均合法。
- **补充边界：** 把 postMean 改成 `-0.001` 或 `1.001`，应抛出 `postMean out of bounds`。
- **代码位置：** `empirical-prior.ts / runEmpiricalPriorSelfChecks` 默认参数及 postMean 范围检查。

### EP-02：估计器的有效输入和后验计算

- **输入：** `[{id:"A",wins:2,n:10},{id:"B",wins:5,n:10},{id:"C",wins:8,n:10}]`。
- **期望：**
  - 总样本 `30`，加权总体均值 `mu=0.5)。
  - `observedVar=0.06`，`binomialVar=0.019`，`vp=0.041)。
  - `completeShrinkage=false`、`fallback=false)、`reason=null)。
  - `kappa = 0.25/0.041 - 1 = 5.0975609756)。
  - `alpha=beta=2.5487804878)。
  - 三个 bucket 的 `lambda=5.0975609756/(5.0975609756+10)=0.3376413570)。
  - postMean：A=`0.3012924071`，B=`0.5`，C=`0.6987075929`。
- **代码位置：** `empirical-prior.ts / estimateEmpiricalPrior` 的 rawMu、observedVar、binomialVar、vp、kappa、alpha/beta 和 bucket map 计算。

### EP-03：P2 回归——自检失败不能静默回退

- **测试方法（故障注入走查）：**
  1. 使用 EP-02 的有效输入。
  2. 临时在 `estimateEmpiricalPrior` 内部的 `runEmpiricalPriorSelfChecks(result,0,1)` 调用处注入一个确定抛错的自检，例如临时改为调用一个会抛出 `new Error("SELF_CHECK_INJECTED")` 的诊断函数。
  3. 检查自检异常被内层 catch 捕获后，恢复原代码。
- **期望：**
  - 返回结果仍为 `fallback=false`。
  - `alpha/beta/mu/kappa/buckets` 保留 EP-02 的计算结果，不被替换成 Beta(1,1)。
  - `selfCheckWarning="SELF_CHECK_INJECTED"`（或实际注入错误文本）。
  - 产生 `[empirical-prior] self-check warning:` warning。
- **反例判定：** 若返回 `alpha=1,beta=1,mu=0.5,fallback=true`，即仍发生整体静默回退，测试失败。
- **代码位置：** `empirical-prior.ts / estimateEmpiricalPrior` 内层自检 try/catch；`fallback` 函数仅应处理估计本身的错误。

### EP-04：P4 回归——fallback reason 必须反映实际原因

- **输入 A：** `estimateEmpiricalPrior([{id:"A",wins:0,n:0}])`。
- **期望 A：** `fallback=true`，`reason="总样本数为 0（输入桶数：1）"`。
- **输入 B：** `estimateEmpiricalPrior([{id:"A",wins:1,n:5},{id:"B",wins:2,n:5}])`。
- **期望 B：** `fallback=true`，reason 包含 `有效桶少于要求数量 3 个（实际：2）`。
- **代码位置：** `empirical-prior.ts / estimateEmpiricalPrior` 的 fallback 分支；`empirical-prior.ts / fallback`。

### EP-05：completeShrinkage 的共同均值

- **输入：** 三个 bucket：`[{id:"A",wins:4,n:10},{id:"B",wins:5,n:10},{id:"C",wins:6,n:10}]`。
- **期望：** `vp<0`，所以 `completeShrinkage=true`；`mu=0.5`；所有 bucket 的 `postMean=0.5`、`lambda=1`。
- **代码位置：** `empirical-prior.ts / estimateEmpiricalPrior` 的 completeShrinkage 分支。

### EP-06：completeShrinkage 自检必须验证共同后验不变量

- **输入：** 使用 EP-05 的三桶输入，先调用 `estimateEmpiricalPrior` 得到 completeShrinkage 结果。
- **期望：** `runEmpiricalPriorSelfChecks(result)` 不抛错；结果中每个 bucket 都满足 `lambda=1` 且 `postMean=result.mu`（误差不超过 `1e-12`）。
- **故障注入：** 分别把任意一个 bucket 的 `lambda` 改为 `0.99`，或把 `postMean` 改为 `result.mu+0.01`；调用自检必须抛出 `complete shrinkage requires lambda=1 and postMean=mu`。
- **代码位置：** `empirical-prior.ts / runEmpiricalPriorSelfChecks` 的 completeShrinkage 不变量检查。

---

## 3. 贝叶斯 FDR

文件：`src/lib/bayes/fdr.ts`

### FDR-01：minN=5 过滤零样本和小样本战法（回归）

- **输入：**
  ```ts
  [
    {id:"zero", regime:"WARMING", wins:0, n:0},
    {id:"small", regime:"WARMING", wins:4, n:4},
    {id:"eligible", regime:"WARMING", wins:5, n:5}
  ]
  ```
  调用 `selectBayesianFdr(input)`，不传 options。
- **期望：**
  - 默认 `minN=5`。
  - `results` 只包含 `eligible`，其 `n=5`。
  - `zero`、`small` 均不得出现在 `results` 或 `selectedIds`。
  - 单一 eligible 战法没有其他同 regime 参照，p0 使用 globalBaseline=`1` 并经 clamp 成 `0.999999999`；不能因零样本战法而被错误选中。
  - 不要求 eligible 必须入选；核心断言是 n<5 的 ID 永远不能入选。
- **代码位置：** `fdr.ts / selectBayesianFdr` 的 `minN` 默认值和 `input.filter(x=>x.n>=minN)`。

### FDR-02：无战法达到 minN 时返回空结果且不是计算异常

- **输入：** `[{id:"zero",regime:"ICE",wins:0,n:0},{id:"four",regime:"ICE",wins:2,n:4}]`。
- **期望：** `fallback=false`、`results=[]`、`selectedIds=[]`、`cutoffIndex=0`、`reason="No strategies meet minN=5"`。
- **代码位置：** `fdr.ts / selectBayesianFdr` 的 eligible 空数组分支。

### FDR-03：minN 可配置

- **输入：** `[{id:"A",regime:"ICE",wins:3,n:3},{id:"B",regime:"ICE",wins:4,n:4}]`，options=`{minN:3}`。
- **期望：** A、B 都进入 `results`；不允许仍硬编码只接受 n≥5。
- **代码位置：** `fdr.ts / selectBayesianFdr` 的 options 解析和 eligible 过滤。

### FDR-04：fallback reason 字段存在（回归）

- **输入：** `selectBayesianFdr([{id:"A",regime:"ICE",wins:1,n:5}],{q:1})`。
- **期望：** 参数校验失败后 `fallback=true`；返回对象必须具有 `reason` 字段，值为 `"Invalid FDR inputs"`；不能缺字段或只返回空对象。
- **代码位置：** `fdr.ts / selectBayesianFdr` 的 empty 结果和 catch 分支。

### FDR-05：同 regime leave-one-out 基准

- **输入：** `A=(wins:2,n:10)`、`B=(wins:8,n:10)`，均为 `regime:"WARMING"`。
- **期望：** A 的 `p0=0.8`，B 的 `p0=0.2`；各自基准只由同 regime 的其他战法计算。
- **代码位置：** `fdr.ts / selectBayesianFdr` 的 same/reference/p0 计算。

---

## 4. Regime 权重调度器

文件：`src/lib/bayes/regime-weight.ts`

以下调度用例统一使用：
- `regime:"WARMING"`。
- probabilities 为五个 regime 的合法概率，且总和为 1。
- `targetWeights=[0.25,0.25,0.25,0.25]`（无 regime 专属目标时的 fallback target）。
- `targetWeightsByRegime.WARMING=[0.4,0.3,0.2,0.1]`。
- `state.previousWeights=[0.25,0.25,0.25,0.25]`。
- `independentSegmentSamples=60`，`targetBeatsEqualWeight=true)。
- 除特别说明外，`lastTradeDay=null`、`lastReviewDay=null`、`dayIndex=10)。

### RW-01：R1 回归——首次事件每个分量最多变化 0.03

- **输入：** 上述统一输入，`eventTriggered=true`、`t4Triggered=false`，默认 step=`0.03`。
- **期望：** `mode="ACTIVE"`、`tradeTriggered=true`；权重为 `[0.28,0.28,0.22,0.22]`。
- **断言：** 每个分量相对 previous 的绝对变化均≤0.03；权重和为 1。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 eventDue 分支；`regime-weight.ts / boundedStep`。

### RW-02：R1 回归——无事件经过自然日不能累积步长

- **输入：** previous 改为 RW-01 的输出 `[0.28,0.28,0.22,0.22]`；`dayIndex=14`；`lastTradeDay=10`；`eventTriggered=false`、`t4Triggered=false`；目标仍为 `[0.4,0.3,0.2,0.1]`。
- **期望：** `tradeTriggered=false`，权重仍为 `[0.28,0.28,0.22,0.22]`，state.previousWeights 不变。即使经过 4 天，也不能因为每日刷新目标而自动走第二步。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 `eventDue?boundedStep(...):previous`。

### RW-03：R1 回归——第二次调仓事件再走一步

- **输入：** previous=`[0.28,0.28,0.22,0.22]`；`dayIndex=15`；`lastTradeDay=10`；`eventTriggered=true`；冷却默认 5 天。
- **期望：** `tradeTriggered=true`；新权重 `[0.31,0.30,0.20,0.19]`；每个分量相对上次实际权重变化≤0.03。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 cooldown/eventDue 计算；`boundedStep`。

### RW-04：R2 回归——OFF 保留实际权重，不重置等权

- **输入：** `independentSegmentSamples=39`；previous=`[0.4,0.3,0.2,0.1]`；其他字段合法。
- **期望：** `mode="OFF"`、`tradeTriggered=false`；返回 weights 和 state.previousWeights 都严格为 `[0.4,0.3,0.2,0.1]`，不能变成 `[0.25,0.25,0.25,0.25]`。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 samples<off 分支。

### RW-05：R2 回归——SHADOW 保留实际权重，不重置等权

- **输入：** `independentSegmentSamples=50`；previous=`[0.4,0.3,0.2,0.1]`；`targetBeatsEqualWeight=true`。
- **期望：** `mode="SHADOW"`、`tradeTriggered=false`、`reviewTriggered=true)；weights 和 state.previousWeights 保留 `[0.4,0.3,0.2,0.1]`。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 samples<shadow 分支。

### RW-06：R3 回归——确认 regime 概率恰好 0.5 时使用对应目标

- **输入：** `probabilities={ICE:0.1,RECOVERY:0.1,WARMING:0.5,EUPHORIA:0.2,EXTREME:0.1}`；`eventTriggered=true)；regime 专属目标为 `[0.4,0.3,0.2,0.1]`。
- **期望：** 选择 WARMING 专属目标；首次调仓结果为 `[0.28,0.28,0.22,0.22]`。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 `regimeTarget && probabilities[regime]>=0.5`。

### RW-07：R3 回归——概率低于 0.5 时使用通用目标

- **输入：** `probabilities={ICE:0.1,RECOVERY:0.2,WARMING:0.49,EUPHORIA:0.1,EXTREME:0.11}`；WARMING 专属目标仍为 `[0.4,0.3,0.2,0.1]`；通用目标为 `[0.25,0.25,0.25,0.25])；`eventTriggered=true)。
- **期望：** 选通用目标；由于通用目标与 previous 相同，返回权重仍为 `[0.25,0.25,0.25,0.25]`。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 regimeTarget 选择表达式。

### RW-08：T4 复核不等于交易事件

- **输入：** ACTIVE 合法输入；`eventTriggered=false`、`t4Triggered=true`、`lastReviewDay=null)。
- **期望：** `reviewTriggered=true`，但 `tradeTriggered=false)，权重保持 previous；T4 复核本身不消耗 R1 调仓步长。
- **代码位置：** `regime-weight.ts / scheduleRegimeWeights` 的 t4Due、eventDue 和 proposedWeights。

---

## 5. 装配层端到端

文件：`src/lib/bayes/assemble.ts`

### ASM-01：完整字段端到端基准（手算固定样本）

- **输入：**
  ```ts
  const groups = [{
    regime: "WARMING",
    buckets: [
      { id: "A", wins: 2, n: 10 },
      { id: "B", wins: 5, n: 10 },
      { id: "C", wins: 8, n: 10 }
    ]
  }];

  const options = {
    names: { A: "低胜率战法", B: "中胜率战法", C: "高胜率战法" }
  };
  ```
  调用 `assembleBayesStrategyViewData(groups, options)`。
- **经验先验手算：**
  - `mu=0.5)、`observedVar=0.06`、`binomialVar=0.019`、`vp=0.041`。
  - `kappa=5.0975609756`，`alpha=beta=2.5487804878`。
  - `completeShrinkage=false`、`fallback=false`。
- **期望顶层字段：**
  - `regimes=["WARMING"]`。
  - `vpNonPositiveRegimes=[]`。
  - `priorFallbackRegimes=[]`。
  - `warnings=[]`。
  - `strategies` 按输入顺序 A、B、C。
  - `fdr.q=0.1`、`fdr.globalBaseline=0.5`、`fdr.fallback=false`、`fdr.reason=null`。
  - `fdr.selectedIds=["C"]`、`fdr.cutoffIndex=1`、`fdr.averageVAtCutoff=0.0020383695`（误差≤1e-6）。
- **期望 strategies 完整字段：**

| id | name | regime | rawWinRate | postMean | hdiLower | hdiUpper | lambda | n | posteriorAlpha | posteriorBeta | rawCountScreen |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A | 低胜率战法 | WARMING | 0.2 | 0.3012924071 | 0.1130408048 | 0.4829790610 | 0.3376413570 | 10 | 4.5487804878 | 10.5487804878 | false |
| B | 中胜率战法 | WARMING | 0.5 | 0.5000000000 | 0.2944464851 | 0.7055535149 | 0.3376413570 | 10 | 7.5487804878 | 7.5487804878 | false |
| C | 高胜率战法 | WARMING | 0.8 | 0.6987075929 | 0.5170209388 | 0.8869591949 | 0.3376413570 | 10 | 10.5487804878 | 4.5487804878 | true |

- **期望 fdr.results（注意排序是 v 从小到大，不是输入顺序）：**

| id | p0 | posteriorAlpha | posteriorBeta | v | selected | rank |
|---|---:|---:|---:|---:|---|---:|
| C | 0.35 | 9 | 3 | 0.0020383695 | true | 1 |
| B | 0.5 | 6 | 6 | 0.5 | false | 2 |
| A | 0.65 | 3 | 9 | 0.9979616305 | false | 3 |

- **手算核对说明：**
  - 各战法的 HDI 使用各自后验 Beta 参数：A=`Beta(4.5487804878,10.5487804878)`；B=`Beta(7.5487804878,7.5487804878)`；C=`Beta(10.5487804878,4.5487804878)`。
  - FDR 使用自己的默认 Beta(1,1) 先验，因此 FDR 后验参数分别为 A=`Beta(3,9)`、B=`Beta(6,6)`、C=`Beta(9,3)`；不要把经验先验参数错误复用到 FDR。
  - 同 regime leave-one-out 基准：A 的 p0=(5+8)/20=0.65；B 的 p0=(2+8)/20=0.5；C 的 p0=(2+5)/20=0.35。
  - `v=P(theta<=p0|data)`，C 的 v 最小并通过 q=0.1 的首个累计均值门槛；加上 B 后平均 v=(0.0020383695+0.5)/2>0.1，因此只选 C。
  - `rawCountScreen` 只表达原始计数 FDR 筛选：`true` 入选、`false` 已参与但未入选、`null` 表示 FDR fallback 或未达到 minN；它不参与后验 `evidence()`，FDR 未入选也不等于证明无差异。
- **代码位置：** `assemble.ts / assembleBayesStrategyViewData`；先验部分 `empirical-prior.ts / estimateEmpiricalPrior`；HDI `hdi.ts / betaHdi`；FDR `fdr.ts / selectBayesianFdr`。

### ASM-02：小样本战法仍展示，但不参与 FDR

- **输入：**
  ```ts
  [{
    regime: "ICE",
    buckets: [
      { id: "A", wins: 2, n: 10 },
      { id: "B", wins: 5, n: 10 },
      { id: "C", wins: 8, n: 10 },
      { id: "D", wins: 0, n: 0 },
      { id: "E", wins: 2, n: 4 }
    ]
  }]
  ```
- **期望：**
  - 如果先验估计成功，strategies 中仍包含 D、E（有对应后验记录）。
  - FDR 的 `results` 不包含 D、E。
  - D、E 的 `rawCountScreen=null`（因为 n<5，未参与 FDR）；不能将其解释为 FDR 未入选。
  - A/B/C 是否入选只由这三个合格战法决定。
- **代码位置：** `assemble.ts / assembleBayesStrategyViewData` 的 posteriorById、fdrInput 过滤和 rawCountScreen 映射。

### ASM-03：每个 regime 单独拟合先验

- **输入：** 两组各自至少三个桶：
  - WARMING：A=(2,10)、B=(5,10)、C=(8,10)。
  - ICE：D=(1,10)、E=(2,10)、F=(3,10)。
- **期望性质：**
  - `estimateEmpiricalPrior` 对两组分别调用，不把六个桶合并拟合。
  - WARMING 的先验参数为 ASM-01 的 `alpha=beta=2.5487804878`。
  - ICE 的先验 `mu=(1+2+3)/30=0.2`，与 WARMING 的 `mu=0.5` 不同。
  - `regimes=["WARMING","ICE"]`，顺序与 groups 输入顺序一致。
- **代码位置：** `assemble.ts / assembleBayesStrategyViewData` 的 group 循环及每组内 `estimateEmpiricalPrior(group.buckets)`。

### ASM-04：重复 ID 必须拒绝

- **输入：** WARMING 和 ICE 两组都含 `{id:"duplicate",wins:2,n:10}`。
- **期望：** 抛出包含 `Duplicate strategy id across regime groups: duplicate` 的错误，不允许 Map/FDR 结果互相覆盖。
- **代码位置：** `assemble.ts / assembleBayesStrategyViewData` 的 ids Set 检查。

### ASM-05：完整收缩时 HDI 不得重新引入桶间差异

- **输入：** 使用三桶 A=(4,10)、B=(5,10)、C=(6,10)，使组内观测桶间方差小于二项噪声方差，得到 `vp<0`。
- **期望：**
  - `vpNonPositiveRegimes=["WARMING"]`（本用例 regime 设为 WARMING）。
  - `priorFallbackRegimes=[]`（这是 completeShrinkage，不是估计 fallback）。
  - 输入组为 `{ regime: "WARMING", buckets: [{id:"A",wins:4,n:10},{id:"B",wins:5,n:10},{id:"C",wins:6,n:10}] }`。
  - 三个战法使用同一组 HDI 参数 `Beta(prior.alpha,prior.beta)`，因此三个 `hdiLower/hdiUpper` 必须完全相同；不能再把各自 wins 加回去制造区间差异。
  - 三个桶的 `rawCountScreen` 只反映原始计数 FDR 结果，不得改变后验判断；允许它与共同 HDI/完全收缩并存。
- **代码位置：** `assemble.ts / assembleBayesStrategyViewData` 的 `prior.completeShrinkage ? prior.alpha : prior.alpha+bucket.wins` 分支。

### ASM-05b：完全收缩与 FDR 入选同时存在时，后验判断仍为证据不足

- **输入：**
  ```ts
  const groups = [{
    regime: "ICE",
    buckets: [
      { id: "A", wins: 0, n: 10 },
      { id: "B", wins: 1, n: 10 },
      { id: "C", wins: 2, n: 10 }
    ]
  }];
  const data = assembleBayesStrategyViewData(groups);
  ```
- **先验 / FDR 核对：**
  - 三个桶的原始胜率为 0、0.1、0.2，加权总体均值 `mu=0.1`。
  - `observedVar=0.0066666667`、`binomialVar=0.0083333333`、`vp=-0.0016666667`，因此 `completeShrinkage=true`。
  - `vpNonPositiveRegimes=["ICE"]`，且 `priorFallbackRegimes=[]`。
  - FDR 的 leave-one-out 基准分别为 A=`0.15`、B=`0.10`、C=`0.05`；默认 `q=0.10` 下只有 C 入选，故按 A、B、C 输入顺序 `rawCountScreen=[false,false,true]`。
- **装配层期望：**
  - 三个 bucket 的 `lambda` 均为 `1`，`postMean` 均为 `0.1`。
  - 三个 bucket 的 `hdiLower` 完全相同，`hdiUpper` 完全相同（均使用同一个 regime-level `Beta(prior.alpha, prior.beta)` 后验）。
  - `rawCountScreen` 依次为 `false,false,true`；特别确认 C 的 `true` 不会改变其后验判断。
- **展示层期望：** 将 `data.strategies`、`data.vpNonPositiveRegimes` 和 `data.regimes` 传给 `BayesStrategyView`：
  - ICE 的完全收缩提示 banner 可见。
  - A、B、C 三张卡片的后验判断均为 `INSUFFICIENT`（界面文案“样本不足”），因为 `lambda=1` 达到默认 insufficient 阈值。
  - C 卡片仍显示“原始计数 FDR（探索性）：入选”，但后验判断仍是“样本不足”。
  - 页面不得出现 `NO_DIFFERENCE` 标签，也不得出现旧格式 `FDR 入选 · ` 前缀。
- **代码位置：** `assemble.ts / assembleBayesStrategyViewData` 的 complete-shrinkage、FDR 与 `rawCountScreen` 映射；`BayesStrategyView.tsx / evidence`、完全收缩 banner 和原始计数 FDR 展示。

---

### ASM-06：经验先验自检警告必须传递到 API warnings

- **输入：** 使用一个可成功拟合的 regime（至少三个有效桶），并在 `estimateEmpiricalPrior` 内部自检处注入 `Error("SELF_CHECK_INJECTED")`。
- **期望：** 经验先验仍返回 `fallback=false` 并保留估计参数；装配结果的 `warnings` 必须包含 `Regime WARMING 经验先验自检警告：SELF_CHECK_INJECTED`（regime 名称按输入替换）。
- **反例判定：** 若警告只出现在控制台，未进入 `BayesAssemblyResult.warnings`，则测试失败。
- **代码位置：** `empirical-prior.ts / estimateEmpiricalPrior` 的 `selfCheckWarning`；`assemble.ts / assembleBayesStrategyViewData` 的 warnings 汇总；`StrategyView.tsx` 的 `data.bayes.warnings` 展示。

---

## 6. 最终回归核对表

测试者完成后逐项标记：

- [ ] HDI-01 至 HDI-04：数值、边界和 CDF 反演。
- [ ] HDI-05：注入常数/NaN regularizedBeta 后，导入 hdi.ts 必须抛错。
- [ ] EP-01：默认 postMean 边界口径。
- [ ] EP-02：经验先验手算基准。
- [ ] EP-03：注入自检失败后保留结果并写 warning。
- [ ] EP-04：fallback reason 不是硬编码通用文案。
- [ ] EP-05：completeShrinkage 的共同均值。
- [ ] EP-06：completeShrinkage 自检验证共同后验不变量。
- [ ] FDR-01 至 FDR-05：minN、空 eligible、配置覆盖、fallback reason、leave-one-out。
- [ ] RW-01 至 RW-08：事件步长、OFF/SHADOW 保留、regime 阈值、T4 不触发交易。
- [ ] ASM-01：完整端到端字段和数值。
- [ ] ASM-02 至 ASM-06（含 ASM-05b）：小样本、regime 隔离、重复 ID、完全收缩 HDI、自检警告传递、完全收缩下入选策略的后验隔离。

**报告要求：** 每项写“通过 / 失败 / 无法手算确认”；失败时附实际代码片段、手算过程和期望/实际差异。不要把未执行的测试标记为通过。
