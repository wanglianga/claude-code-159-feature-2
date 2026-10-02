import { describe, expect, it } from 'vitest'
import { buildAllocationSuggestion, findMutualAid, type NightApplicant } from '@/utils/allocation'
import { estimateDistanceMeters, parseBuilding } from '@/utils/community'
import { addDays } from '@/utils/date'
import type { MutualAidPoint } from '@/types'

const NOW = '2026-09-27T01:50:00'

function applicant(over: Partial<NightApplicant> & { applicantId: string; applicantName: string }): NightApplicant {
  return {
    requestId: `r_${over.applicantId}`,
    urgency: 'normal',
    hasChild: true,
    distanceMeters: 200,
    quantity: 1,
    method: 'self_pickup',
    createdAt: NOW,
    ...over,
  }
}

const POINTS: MutualAidPoint[] = [
  {
    id: 'mp1',
    community: '安康苑小区',
    distanceMeters: 900,
    contact: '周师傅',
    stocks: [{ category: 'fever_patch', name: '医用退热贴', spec: '4贴/盒', quantity: 3, expiryDate: addDays(NOW, 100).slice(0, 10) }],
  },
]

describe('楼栋距离估算', () => {
  it('解析楼栋号', () => {
    expect(parseBuilding('幸福里小区 3号楼1单元')).toBe(3)
    expect(parseBuilding('社区居委会')).toBeUndefined()
  })
  it('同栋 60 米，每差一栋 +90 米', () => {
    expect(estimateDistanceMeters({ address: '3号楼' }, '3号楼共享柜')).toBe(60)
    expect(estimateDistanceMeters({ address: '2号楼', building: 2 }, '5号楼便民架')).toBe(60 + 3 * 90)
  })
})

describe('夜间分配评分建议', () => {
  it('紧急度 > 儿童 > 距离 决定排名，平分时申请更早者优先', () => {
    const a = applicant({ applicantId: 'a', applicantName: '一般但近', urgency: 'normal', distanceMeters: 60, createdAt: '2026-09-27T01:35:00' })
    const b = applicant({ applicantId: 'b', applicantName: '紧急但远', urgency: 'critical', distanceMeters: 1200, createdAt: '2026-09-27T01:35:00' })
    const c = applicant({ applicantId: 'c', applicantName: '较急有儿童中距', urgency: 'urgent', distanceMeters: 300, createdAt: '2026-09-27T01:35:00' })
    const res = buildAllocationSuggestion({
      item: { id: 'i1', name: '退热贴', location: '3号楼' },
      stockQty: 3,
      applicants: [a, b, c],
      deliveryCapacity: 2,
      alternativesFor: () => [],
      mutualAidPoints: [],
      now: NOW,
    })
    const names = res.decisions.map((d) => d.applicantName)
    // 较急@300m=71 分 > 紧急@1200m=70 分（距离拉开差距）> 一般@60m=59 分
    expect(names).toEqual(['较急有儿童中距', '紧急但远', '一般但近'])
  })

  it('库存按排序分配，超出库存的家庭进入未分配', () => {
    const list = [
      applicant({ applicantId: 'a', applicantName: 'A', urgency: 'normal' }),
      applicant({ applicantId: 'b', applicantName: 'B', urgency: 'critical' }),
      applicant({ applicantId: 'c', applicantName: 'C', urgency: 'urgent' }),
      applicant({ applicantId: 'd', applicantName: 'D', urgency: 'normal' }),
    ]
    const res = buildAllocationSuggestion({
      item: { id: 'i1', name: '退热贴', location: '3号楼' },
      stockQty: 2,
      applicants: list,
      deliveryCapacity: 2,
      alternativesFor: () => [],
      mutualAidPoints: [],
      now: NOW,
    })
    expect(res.allocatedCount).toBe(2)
    expect(res.unmetCount).toBe(2)
    expect(res.decisions.find((d) => d.applicantName === 'B')!.suggestion).toBe('allocate')
    const d = res.decisions.find((x) => x.applicantName === 'D')!
    expect(d.suggestion).not.toBe('allocate')
    expect(d.allocatedQty).toBe(0)
    // 每个决策都必须有可读理由（答复质疑用）
    expect(d.reasons.join(' ')).toContain('库存')
  })

  it('库存够但志愿者夜间运力已满：标记运力卡住而不是直接判库存不足，并给出互助建议', () => {
    const list = [
      applicant({ applicantId: 'a', applicantName: '甲', urgency: 'critical', method: 'volunteer_delivery' }),
      applicant({ applicantId: 'b', applicantName: '乙', urgency: 'critical', method: 'volunteer_delivery' }),
      applicant({ applicantId: 'c', applicantName: '丙', urgency: 'critical', method: 'volunteer_delivery' }),
    ]
    const res = buildAllocationSuggestion({
      item: { id: 'i1', name: '退热贴', location: '3号楼' },
      stockQty: 3,
      applicants: list,
      deliveryCapacity: 2,
      alternativesFor: () => [],
      mutualAidPoints: POINTS,
      now: NOW,
    })
    // 前两户分配并占用 2 个代送名额
    expect(res.decisions[0].suggestion).toBe('allocate')
    expect(res.decisions[1].suggestion).toBe('allocate')
    const blocked = res.decisions[2]
    expect(blocked.suggestion).toBe('mutual_aid')
    expect(blocked.capacityBlocked).toBe(true)
    expect(blocked.fallbackOptions.join(' ')).toContain('安康苑')
  })

  it('选择自取/门口交接不占用代送名额，运力不影响其分配', () => {
    const list = [
      applicant({ applicantId: 'a', applicantName: '甲', urgency: 'critical', method: 'door_contactless' }),
      applicant({ applicantId: 'b', applicantName: '乙', urgency: 'critical', method: 'self_pickup' }),
      applicant({ applicantId: 'c', applicantName: '丙', urgency: 'critical', method: 'self_pickup' }),
    ]
    const res = buildAllocationSuggestion({
      item: { id: 'i1', name: '退热贴', location: '3号楼' },
      stockQty: 3,
      applicants: list,
      deliveryCapacity: 0,
      alternativesFor: () => [],
      mutualAidPoints: [],
      now: NOW,
    })
    expect(res.allocatedCount).toBe(3)
  })

  it('紧急家庭未分配时包含就医提示；一般家庭未分配时保留到货补发路径', () => {
    const critical = applicant({ applicantId: 'a', applicantName: '急', urgency: 'critical' })
    const normal = applicant({ applicantId: 'b', applicantName: '缓', urgency: 'normal' })
    const res = buildAllocationSuggestion({
      item: { id: 'i1', name: '退热贴', location: '3号楼' },
      stockQty: 0,
      applicants: [normal, critical],
      deliveryCapacity: 2,
      alternativesFor: () => [],
      mutualAidPoints: [],
      now: NOW,
    })
    const cUnmet = res.decisions.find((d) => d.applicantName === '急')!
    const nUnmet = res.decisions.find((d) => d.applicantName === '缓')!
    expect(cUnmet.fallbackOptions.join(' ')).toContain('就医')
    expect(cUnmet.suggestion).toBe('medical')
    expect(nUnmet.fallbackOptions.join(' ')).toContain('补发')
    expect(nUnmet.suggestion).toBe('waiting_backfill')
  })

  it('有同用途替代品（冷敷冰袋）时给出改选建议', () => {
    const res = buildAllocationSuggestion({
      item: { id: 'i1', name: '退热贴', location: '3号楼' },
      stockQty: 0,
      applicants: [applicant({ applicantId: 'a', applicantName: '甲', urgency: 'urgent' })],
      deliveryCapacity: 2,
      alternativesFor: () => [{ id: 'i13', name: '一次性医用冰袋（冷敷）', spec: '100g/袋', availableQty: 6, distanceMeters: 150 }],
      mutualAidPoints: [],
      now: NOW,
    })
    expect(res.decisions[0].suggestion).toBe('alternative')
    expect(res.decisions[0].fallbackOptions.join(' ')).toContain('冰袋')
  })

  it('findMutualAid 只返回在有效期内有余量的最近互助点', () => {
    const points: MutualAidPoint[] = [
      { id: 'x', community: '远小区', distanceMeters: 2000, contact: '', stocks: [{ category: 'fever_patch', name: '退热贴', spec: 'x', quantity: 1, expiryDate: addDays(NOW, 10).slice(0, 10) }] },
      { id: 'y', community: '近小区', distanceMeters: 800, contact: '', stocks: [{ category: 'fever_patch', name: '退热贴', spec: 'x', quantity: 1, expiryDate: addDays(NOW, 10).slice(0, 10) }] },
      ...POINTS,
    ]
    expect(findMutualAid(points, 'fever_patch', NOW)?.point.community).toBe('近小区')
    const expired: MutualAidPoint[] = [{ id: 'e', community: '过期小区', distanceMeters: 100, contact: '', stocks: [{ category: 'fever_patch', name: '退热贴', spec: 'x', quantity: 1, expiryDate: addDays(NOW, -1).slice(0, 10) }] }]
    expect(findMutualAid(expired, 'fever_patch', NOW)).toBeUndefined()
    expect(findMutualAid(points, 'mask', NOW)).toBeUndefined()
  })

  it('纯函数：相同输入得到完全一致的排序与分数', () => {
    const mk = () =>
      buildAllocationSuggestion({
        item: { id: 'i1', name: '退热贴', location: '3号楼' },
        stockQty: 1,
        applicants: [
          applicant({ applicantId: 'a', applicantName: '甲', urgency: 'urgent', createdAt: '2026-09-27T01:30:00' }),
          applicant({ applicantId: 'b', applicantName: '乙', urgency: 'critical', createdAt: '2026-09-27T01:31:00' }),
        ],
        deliveryCapacity: 1,
        alternativesFor: () => [],
        mutualAidPoints: POINTS,
        now: NOW,
      })
    expect(JSON.stringify(mk().decisions)).toBe(JSON.stringify(mk().decisions))
  })
})
