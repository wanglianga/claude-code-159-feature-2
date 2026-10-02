import { describe, expect, it } from 'vitest'
import type { BorrowRequest } from '@/types'
import {
  CHILD_POINTS,
  DELIVERY_POINTS,
  distancePointsOf,
  planAllocation,
  scoreRequest,
  suggestedAidRoute,
  URGENCY_POINTS,
} from '@/rules'

function req(over: Partial<BorrowRequest> & Pick<BorrowRequest, 'id' | 'applicantId' | 'applicantName' | 'createdAt'>): BorrowRequest {
  return {
    itemId: 'i13',
    scene: 'child_night_fever',
    quantity: 1,
    method: 'self_pickup',
    status: 'waiting',
    urgency: 'spare',
    hasChild: false,
    ...over,
  }
}

describe('distancePointsOf 距离分档', () => {
  it('200/500/1000 米分档给分，超过 1 公里 0 分，未填距离按最远处理', () => {
    expect(distancePointsOf(0).points).toBe(15)
    expect(distancePointsOf(200).points).toBe(15)
    expect(distancePointsOf(300).points).toBe(10)
    expect(distancePointsOf(900).points).toBe(5)
    expect(distancePointsOf(1200).points).toBe(0)
    expect(distancePointsOf(undefined).points).toBe(0)
  })
})

describe('scoreRequest 单申请评分', () => {
  it('儿童高热 + 有儿童 + 近距离 + 有运力代送 得到最高分组合', () => {
    const r = req({
      id: 'a',
      applicantId: 'u_d',
      applicantName: '张晨',
      createdAt: '2026-09-26T23:00:00',
      urgency: 'child_high_fever',
      hasChild: true,
      childAge: 3,
      temperature: 39.4,
      distanceMeters: 150,
      method: 'volunteer_delivery',
    })
    const s = scoreRequest(r, { orderIndex: 0, total: 1, deliveryBonus: true })
    expect(s.details.urgencyPoints).toBe(URGENCY_POINTS.child_high_fever)
    expect(s.details.childPoints).toBe(CHILD_POINTS)
    expect(s.details.distancePoints).toBe(15)
    expect(s.details.deliveryPoints).toBe(DELIVERY_POINTS)
    expect(s.score).toBe(50 + 20 + 15 + 10)
    // 四个评分维度都有可解释的人话理由（次序分不单独说明）
    expect(s.details.reasons.length).toBe(4)
    expect(s.details.reasons.join('')).toContain('儿童高热')
  })

  it('运力排满时代送申请不加分，自取也不加分', () => {
    const delivery = req({ id: 'b', applicantId: 'x', applicantName: 'X', createdAt: 't', method: 'volunteer_delivery' })
    expect(scoreRequest(delivery, { orderIndex: 0, total: 1, deliveryBonus: false }).details.deliveryPoints).toBe(0)
    const pickup = req({ id: 'c', applicantId: 'y', applicantName: 'Y', createdAt: 't', method: 'self_pickup' })
    expect(scoreRequest(pickup, { orderIndex: 0, total: 1, deliveryBonus: true }).details.deliveryPoints).toBe(0)
  })
})

describe('planAllocation 夜间争抢分配', () => {
  const base = { itemId: 'i13', scene: 'child_night_fever' as const, quantity: 1, status: 'waiting' as const }

  it('按 紧急程度→儿童→距离→配送能力→申请先后 排序，库存只够 1 盒时最高分者得', () => {
    const requests: BorrowRequest[] = [
      req({ ...base, id: 'r_spare', applicantId: 'u_h', applicantName: '周文(备货)', createdAt: '2026-09-26T23:00:30', urgency: 'spare', hasChild: true, distanceMeters: 1800 }),
      req({ ...base, id: 'r_low', applicantId: 'u_g', applicantName: '赵桂兰(低热)', createdAt: '2026-09-26T23:00:40', urgency: 'low_fever', hasChild: true, childAge: 10, temperature: 37.8, distanceMeters: 1200 }),
      req({ ...base, id: 'r_adult', applicantId: 'u_f', applicantName: '杨光(成人发烧)', createdAt: '2026-09-26T23:00:50', urgency: 'fever', hasChild: false, temperature: 38.2, distanceMeters: 900, method: 'volunteer_delivery' }),
      req({ ...base, id: 'r_mom', applicantId: 'u_e', applicantName: '李梅(孩子发烧)', createdAt: '2026-09-26T23:01:00', urgency: 'fever', hasChild: true, childAge: 7, temperature: 38.6, distanceMeters: 300 }),
      req({ ...base, id: 'r_high', applicantId: 'u_d', applicantName: '张晨(儿童高热)', createdAt: '2026-09-26T23:01:10', urgency: 'child_high_fever', hasChild: true, childAge: 3, temperature: 39.4, distanceMeters: 150, method: 'volunteer_delivery' }),
    ]
    const plan = planAllocation({ requests, availableQty: 1, volunteerCapacity: 2 })
    expect(plan.ranked[0].req.id).toBe('r_high')
    expect(plan.ranked[1].req.id).toBe('r_mom')
    expect(plan.ranked.map((x) => x.req.id).slice(2)).toEqual(['r_adult', 'r_low', 'r_spare'])
    expect(plan.allocatedRequestIds).toEqual(['r_high'])
    expect(plan.unallocatedRequestIds).toHaveLength(4)
  })

  it('库存逐单整盒切分：高分单吃不下时跳过，继续尝试后面的申请', () => {
    const requests: BorrowRequest[] = [
      // 高分但要 2 盒
      req({ ...base, id: 'big', quantity: 2, applicantId: 'a', applicantName: 'A', createdAt: 't1', urgency: 'child_high_fever', hasChild: true, distanceMeters: 50 }),
      // 中分 1 盒
      req({ ...base, id: 'mid', quantity: 1, applicantId: 'b', applicantName: 'B', createdAt: 't2', urgency: 'fever', hasChild: true, distanceMeters: 400 }),
      // 低分 1 盒
      req({ ...base, id: 'low', quantity: 1, applicantId: 'c', applicantName: 'C', createdAt: 't3', urgency: 'low_fever', distanceMeters: 800 }),
    ]
    const plan = planAllocation({ requests, availableQty: 2, volunteerCapacity: 0 })
    // big 拿 2 盒后库存为 0；其余两户都分不到
    expect(plan.allocatedRequestIds).toEqual(['big'])

    const plan2 = planAllocation({ requests, availableQty: 1, volunteerCapacity: 0 })
    // big 需要 2 盒吃不下 → 跳过；mid 拿到 1 盒；low 无库存
    expect(plan2.allocatedRequestIds).toEqual(['mid'])
    expect(plan2.unallocatedRequestIds).toContain('big')
    expect(plan2.unallocatedRequestIds).toContain('low')
  })

  it('配送运力只给排序靠前的代送申请，运力为 0 时无人获得配送分', () => {
    const requests: BorrowRequest[] = [
      req({ ...base, id: 'd1', applicantId: '1', applicantName: '一', createdAt: 't1', urgency: 'fever', hasChild: true, distanceMeters: 800, method: 'volunteer_delivery' }),
      req({ ...base, id: 'd2', applicantId: '2', applicantName: '二', createdAt: 't2', urgency: 'fever', hasChild: true, distanceMeters: 800, method: 'volunteer_delivery' }),
    ]
    const plan = planAllocation({ requests, availableQty: 2, volunteerCapacity: 1 })
    expect(plan.deliveryUsed).toBe(1)
    const withBonus = plan.ranked.find((x) => x.details.deliveryPoints === DELIVERY_POINTS)
    const without = plan.ranked.find((x) => x.details.deliveryPoints === 0)
    expect(withBonus?.req.id).toBe('d1')
    expect(without?.req.id).toBe('d2')
  })

  it('其余因子相同时，申请时间更早者排在前面', () => {
    const requests: BorrowRequest[] = [
      req({ ...base, id: 'later', applicantId: '2', applicantName: '后申请', createdAt: '2026-09-26T23:05:00', urgency: 'fever', distanceMeters: 300 }),
      req({ ...base, id: 'earlier', applicantId: '1', applicantName: '先申请', createdAt: '2026-09-26T23:00:00', urgency: 'fever', distanceMeters: 300 }),
    ]
    const plan = planAllocation({ requests, availableQty: 0, volunteerCapacity: 0 })
    expect(plan.ranked[0].req.id).toBe('earlier')
    expect(plan.allocatedRequestIds).toEqual([])
    expect(plan.unallocatedRequestIds).toHaveLength(2)
  })
})

describe('suggestedAidRoute 未分到后的默认出路', () => {
  it('儿童高热默认就医提示，备货默认替代用品，发烧默认相邻小区', () => {
    expect(suggestedAidRoute(req({ id: '1', applicantId: 'a', applicantName: 'A', createdAt: 't', urgency: 'child_high_fever' }))).toBe('medical_advice')
    expect(suggestedAidRoute(req({ id: '2', applicantId: 'b', applicantName: 'B', createdAt: 't', urgency: 'spare' }))).toBe('alternative')
    expect(suggestedAidRoute(req({ id: '3', applicantId: 'c', applicantName: 'C', createdAt: 't', urgency: 'fever' }))).toBe('neighbor_community')
  })
})
