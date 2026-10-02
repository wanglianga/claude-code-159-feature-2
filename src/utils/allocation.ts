// 夜间多人同时申请的分配建议（纯函数，便于单元测试与留痕复核）
//
// 评分维度（满分 100）：紧急程度 40 + 是否有儿童 20 + 距离 20 + 库存数量匹配 10 + 志愿者配送能力 10。
// 排序只由“需求侧”因子（紧急度/儿童/距离/库存匹配）决定；志愿者配送能力是夜间硬约束：
// 分数够但当晚代送运力已满的家庭不会被挤出“需求排序”，而是标记 capacityBlocked，
// 建议改自取/门口交接，或转相邻小区互助、收就医提示，到货后仍可凭求助记录补发。
import type {
  AllocationDecision,
  AllocationFactor,
  HandoverMethod,
  Item,
  MutualAidPoint,
  UrgencyLevel,
} from '@/types'
import {
  DISTANCE_REF_METERS,
  SCORE_CAPACITY,
  SCORE_CHILD,
  SCORE_DISTANCE,
  SCORE_STOCK,
  SCORE_URGENCY,
  URGENCY_SCORE,
} from '@/rules'
import { daysUntil } from '@/utils/date'
import { formatDistance } from '@/utils/community'

export interface NightApplicant {
  requestId: string
  applicantId: string
  applicantName: string
  urgency: UrgencyLevel
  hasChild: boolean
  symptom?: string
  distanceMeters: number
  quantity: number
  method: HandoverMethod
  createdAt: string
}

export interface AlternativeItem {
  id: string
  name: string
  spec: string
  availableQty: number
  distanceMeters: number
}

export interface AllocationContext {
  item: Pick<Item, 'id' | 'name' | 'location'>
  /** 当前可分配库存（总量减去已锁定数量） */
  stockQty: number
  applicants: NightApplicant[]
  /** 当晚志愿者剩余代送单数 */
  deliveryCapacity: number
  /** 本小区在有效期内、仍有余量的同类替代用品（距离按申请人住址逐户计算） */
  alternativesFor: (a: NightApplicant) => AlternativeItem[]
  /** 相邻小区互助点（含库存） */
  mutualAidPoints: MutualAidPoint[]
  now: string
}

export interface AllocationSuggestionResult {
  decisions: AllocationDecision[]
  allocatedCount: number
  unmetCount: number
}

function distanceScore(meters: number): number {
  const v = SCORE_DISTANCE * (1 - Math.min(meters, DISTANCE_REF_METERS) / DISTANCE_REF_METERS)
  return Math.round(v)
}

/** 需求侧基础分（决定排名）：紧急度 + 儿童 + 距离 + 库存匹配 */
function baseScore(a: NightApplicant, stockQty: number): { score: number; factors: AllocationFactor[] } {
  const urgency: AllocationFactor = {
    key: 'urgency',
    label: '紧急程度',
    score: URGENCY_SCORE[a.urgency],
    max: SCORE_URGENCY,
    detail:
      a.urgency === 'critical'
        ? '家属描述持续高热/精神差，自报紧急度最高（志愿者需电话核实，社区不做诊断）'
        : a.urgency === 'urgent'
          ? '家属描述发热明显、需要尽快物理降温'
          : '家属描述暂无明显症状，属于备用预防需求',
  }
  const child: AllocationFactor = {
    key: 'child',
    label: '是否有儿童',
    score: a.hasChild ? SCORE_CHILD : 0,
    max: SCORE_CHILD,
    detail: a.hasChild ? '家中有儿童，夜间退热用品优先' : '申请人家中无儿童',
  }
  const dScore = distanceScore(a.distanceMeters)
  const distance: AllocationFactor = {
    key: 'distance',
    label: '距离',
    score: dScore,
    max: SCORE_DISTANCE,
    detail: `住址距取件点约 ${formatDistance(a.distanceMeters)}（夜间步行估算，越近越优先，${DISTANCE_REF_METERS} 米以外距离分为 0）`,
  }
  const fits = a.quantity <= stockQty
  const stock: AllocationFactor = {
    key: 'stock',
    label: '库存数量',
    score: fits ? SCORE_STOCK : 0,
    max: SCORE_STOCK,
    detail: fits
      ? `申请 ${a.quantity} 盒，未超过当晚可分配库存 ${stockQty} 盒，数量可满足`
      : `申请 ${a.quantity} 盒，超过当晚可分配库存 ${stockQty} 盒，数量无法整单满足`,
  }
  return { score: urgency.score + child.score + distance.score + stock.score, factors: [urgency, child, distance, stock] }
}

/** 找到相邻小区里同类物品最近、有余量且在有效期内的互助点 */
export function findMutualAid(
  points: MutualAidPoint[],
  category: Item['category'],
  now: string,
): { point: MutualAidPoint; stockName: string; stockSpec: string; qty: number } | undefined {
  const candidates = points
    .flatMap((p) =>
      p.stocks
        .filter((s) => s.category === category && s.quantity > 0 && daysUntil(s.expiryDate, now) >= 0)
        .map((s) => ({ point: p, stockName: s.name, stockSpec: s.spec, qty: s.quantity })),
    )
    .sort((a, b) => a.point.distanceMeters - b.point.distanceMeters)
  return candidates[0]
}

/**
 * 生成一次夜间多人同时申请的分配建议。
 * 纯函数：相同输入必定得到相同输出，所有分数与理由写入 AllocationDecision，供社区答复质疑。
 */
export function buildAllocationSuggestion(ctx: AllocationContext): AllocationSuggestionResult {
  const { stockQty, deliveryCapacity, alternativesFor, mutualAidPoints, now } = ctx
  // 需求侧基础分排序（分数相同：申请时间更早者优先）
  const ranked = ctx.applicants
    .map((a) => ({ a, base: baseScore(a, stockQty) }))
    .sort((x, y) => (y.base.score !== x.base.score ? y.base.score - x.base.score : x.a.createdAt < y.a.createdAt ? -1 : 1))

  let remainingStock = stockQty
  let remainingSlots = deliveryCapacity
  const decisions: AllocationDecision[] = []

  ranked.forEach(({ a, base }, idx) => {
    const rank = idx + 1
    const factors = [...base.factors]
    const stockOk = remainingStock >= a.quantity
    const needsDelivery = a.method === 'volunteer_delivery'
    const capacityOk = !needsDelivery || remainingSlots > 0
    const allocate = stockOk && capacityOk

    const capacity: AllocationFactor = {
      key: 'capacity',
      label: '志愿者配送能力',
      score: 0,
      max: SCORE_CAPACITY,
      detail: '',
    }
    const reasons: string[] = []
    const fallbackOptions: string[] = []
    let capacityBlocked = false

    if (allocate) {
      remainingStock -= a.quantity
      if (needsDelivery) remainingSlots -= 1
      capacity.score = needsDelivery ? SCORE_CAPACITY : SCORE_CAPACITY
      capacity.detail = needsDelivery
        ? `选择志愿者代送，当晚尚有余力承接（剩余代送名额 ${deliveryCapacity} 单）`
        : '选择自取/邻居门口无接触交接，不占用夜间志愿者代送名额'
      reasons.push(
        `需求侧综合排序第 ${rank} 名（紧急度 ${base.factors[0].score} + 儿童 ${base.factors[1].score} + 距离 ${base.factors[2].score} + 库存 ${base.factors[3].score} = ${base.score} 分）；当晚可分配库存 ${stockQty} 盒，满足其申请 ${a.quantity} 盒${needsDelivery ? '，志愿者代送运力可承接' : ''}，建议优先分配。`,
      )
    } else {
      // 未分配：区分“库存不足”与“运力卡住”
      if (!stockOk) {
        capacity.score = needsDelivery ? 0 : SCORE_CAPACITY
        capacity.detail = needsDelivery
          ? '因库存已在更高排序家庭中分配完，未进入配送排单'
          : '自取/门口交接不占用代送名额，但库存已分完'
        reasons.push(
          `需求侧综合排序第 ${rank} 名（${base.score} 分）；当晚仅 ${stockQty} 盒库存，已按排序分给排名更靠前的家庭，余量不足 ${a.quantity} 盒，本次无法分配。`,
        )
      } else {
        // 库存够但夜间代送运力已满
        capacityBlocked = true
        capacity.score = 0
        capacity.detail = `当晚志愿者仅剩 ${deliveryCapacity} 个代送名额且已被更高排序家庭占用，运力无法承接`
        reasons.push(
          `需求侧综合排序第 ${rank} 名（${base.score} 分），库存本可满足，但选择志愿者代送而当晚运力已满（${deliveryCapacity} 单已排满），建议改为自取/邻居门口交接，或转相邻小区互助。`,
        )
      }
    }
    factors.push(capacity)
    const totalScore = factors.reduce((s, f) => s + f.score, 0)

    // ---- 未分配时的去向建议（按可落地性排序）----
    const mutual = findMutualAid(mutualAidPoints, 'fever_patch', now)
    if (mutual) {
      fallbackOptions.push(
        `转相邻小区「${mutual.point.community}」互助：对方 ${mutual.stockName} ${mutual.stockSpec} 尚余 ${mutual.qty} 盒，距本小区约 ${formatDistance(mutual.point.distanceMeters)}，联系人 ${mutual.point.contact}`,
      )
    }
    const alt = alternativesFor(a)
      .filter((x) => x.availableQty > 0)
      .sort((x, y) => x.distanceMeters - y.distanceMeters)[0]
    if (alt) {
      fallbackOptions.push(
        `改选本小区替代用品：「${alt.name} ${alt.spec}」尚余 ${alt.availableQty} 盒，距其住址约 ${formatDistance(alt.distanceMeters)}，可立即在大厅申请`,
      )
    }
    if (a.urgency === 'critical') {
      fallbackOptions.push('就医提示：如孩子持续高热不退、精神差、抽搐或呼吸异常，请立即就医或拨打 120；途中可温水擦浴物理降温，退热贴仅为辅助、不能替代诊治')
    }
    fallbackOptions.push('保留求助记录：库存到货/共享人补充后，志愿者按本记录顺序补发，无需重新申请')

    let suggestion: AllocationDecision['suggestion']
    if (allocate) {
      suggestion = 'allocate'
    } else if (capacityBlocked) {
      suggestion = mutual ? 'mutual_aid' : a.urgency === 'critical' ? 'medical' : 'waiting_backfill'
    } else if (mutual) {
      suggestion = 'mutual_aid'
    } else if (alt) {
      suggestion = 'alternative'
    } else if (a.urgency === 'critical') {
      suggestion = 'medical'
    } else {
      suggestion = 'waiting_backfill'
    }

    decisions.push({
      requestId: a.requestId,
      applicantId: a.applicantId,
      applicantName: a.applicantName,
      urgency: a.urgency,
      hasChild: a.hasChild,
      symptom: a.symptom,
      distanceMeters: a.distanceMeters,
      requestedQty: a.quantity,
      method: a.method,
      totalScore,
      factors,
      rank,
      suggestion,
      allocatedQty: allocate ? a.quantity : 0,
      capacityBlocked,
      fallbackOptions,
      reasons,
    })
  })

  return {
    decisions,
    allocatedCount: decisions.filter((d) => d.suggestion === 'allocate').length,
    unmetCount: decisions.filter((d) => d.suggestion !== 'allocate').length,
  }
}
