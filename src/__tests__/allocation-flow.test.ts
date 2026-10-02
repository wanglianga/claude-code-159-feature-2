import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMedkitStore } from '@/stores/medkit'
import type { AidRoute } from '@/types'

function nightFactors(over: Record<string, unknown> = {}) {
  return {
    urgency: 'fever' as const,
    hasChild: false,
    distanceMeters: 400,
    ...over,
  }
}

describe('夜间多人争抢分配 —— store 全流程', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('种子数据：昨夜 i13 的分配轮次已执行，未分到居民保留求助记录，质疑待答复', () => {
    const store = useMedkitStore()
    const round = store.allocations.find((a) => a.id === 'alloc1')
    expect(round).toBeTruthy()
    expect(round!.status).toBe('adopted')
    expect(round!.allocatedRequestIds).toContain('r6')
    expect(round!.summary).toContain('张晨')
    expect(round!.summary).toContain('李梅')

    const byId = (id: string) => store.requests.find((r) => r.id === id)!
    expect(byId('r6').allocated).toBe(true)
    expect(byId('r6').status).toBe('handing')
    for (const id of ['r7', 'r8', 'r9', 'r10']) {
      expect(byId(id).allocated).toBe(false)
      expect(byId(id).helpStatus).toBeTruthy()
    }
    // 相邻小区 / 替代用品 / 就医提示三条出路
    expect(byId('r7').aidChosen).toBe('neighbor_community')
    expect(byId('r7').aidNeighborName).toBeTruthy()
    expect(byId('r8').aidChosen).toBe('alternative')
    expect(byId('r8').aidAlternative).toContain('温水擦拭')
    expect(byId('r9').aidChosen).toBe('medical_advice')
    expect(byId('r9').helpStatus).toBe('closed')
    expect(byId('r10').helpStatus).toBe('open')

    // 志愿者到货补发看板与社区质疑看板有数据
    expect(store.openHelpRequests.some((r) => r.id === 'r10')).toBe(true)
    expect(store.openQuestions.some((q) => q.id === 'q1')).toBe(true)

    // 时间线包含分配、出路、质疑事件
    const kinds = store.itemTimeline('i13').map((e) => e.kind)
    expect(kinds).toContain('allocation_adopted')
    expect(kinds).toContain('aid_chosen')
    expect(kinds).toContain('question')
  })

  it('居民无权执行分配；志愿者执行后按评分锁定，未分到者保留求助记录，可走三条出路、到货补发、质疑答复', () => {
    const store = useMedkitStore()
    // i1：总量 2，r3 已锁定 1，仅剩 1 盒；三户夜间同时申请
    store.switchUser('u_d')
    const a1 = store.apply(
      'i1',
      1,
      'child_night_fever',
      'volunteer_delivery',
      '孩子3岁39.5℃',
      nightFactors({ urgency: 'child_high_fever', hasChild: true, childAge: 3, temperature: 39.5, distanceMeters: 150 }),
    )
    expect(a1.ok).toBe(true)
    store.switchUser('u_e')
    expect(
      store.apply('i1', 1, 'child_night_fever', 'self_pickup', '7岁38.6', nightFactors({ urgency: 'fever', hasChild: true, childAge: 7, temperature: 38.6, distanceMeters: 300 })).ok,
    ).toBe(true)
    store.switchUser('u_f')
    expect(store.apply('i1', 1, 'child_night_fever', 'self_pickup', '备货', nightFactors({ urgency: 'spare', distanceMeters: 900 })).ok).toBe(true)

    // 居民不能执行
    expect(store.executeAllocation('i1').ok).toBe(false)

    // 志愿者执行
    store.switchUser('u_v')
    const exec = store.executeAllocation('i1')
    expect(exec.ok).toBe(true)
    const round = store.allocations.find((a) => a.id === exec.roundId)!
    expect(round.allocatedRequestIds).toHaveLength(1)

    const myReq = (uid: string) => store.requests.filter((r) => r.itemId === 'i1' && r.applicantId === uid).slice(-1)[0]
    const high = myReq('u_d')
    const mid = myReq('u_e')
    const low = myReq('u_f')
    expect(high.allocated).toBe(true)
    expect(high.status).toBe('confirmed')
    expect(mid.allocated).toBe(false)
    expect(low.allocated).toBe(false)
    expect(mid.helpStatus).toBe('open')
    expect(low.helpStatus).toBe('open')
    expect(mid.score! > low.score!).toBe(true)
    expect(high.score! > mid.score!).toBe(true)
    // 分配理由含逐项因子
    expect(round.summary).toContain('紧急程度')

    // 未分到居民选择出路
    store.switchUser('u_e')
    const aid = store.chooseAid(mid.id, 'neighbor_community')
    expect(aid.ok).toBe(true)
    expect(mid.aidChosen).toBe('neighbor_community')
    expect(mid.helpStatus).toBe('open') // 选了出路，求助仍挂起等待补发

    // 无库存时补发失败
    store.switchUser('u_v')
    expect(store.fulfillResupply(mid.id).ok).toBe(false)
    // 登记到货后补发成功
    const restocked = store.registerRestock('i1', 3, '夜间短缺补货')
    expect(restocked.ok).toBe(true)
    const fulfilled = store.fulfillResupply(mid.id, undefined, '新到货按求助记录补发')
    expect(fulfilled.ok).toBe(true)
    expect(mid.helpStatus).toBe('fulfilled')
    expect(mid.status).toBe('confirmed')
    expect(mid.fulfilledBy).toBeTruthy()

    // 居民质疑 → 社区答复
    store.switchUser('u_f')
    const asked = store.askAllocation(low.id, '我家也有孩子，为什么没分到？')
    expect(asked.ok).toBe(true)
    const q = store.questions.find((x) => x.requestId === low.id)!
    expect(q.status).toBe('open')
    // 志愿者不能答复质疑
    store.switchUser('u_v')
    expect(store.replyQuestion(q.id, '解释').ok).toBe(false)
    store.switchUser('u_s')
    const reply = store.replyQuestion(q.id, '您的紧急程度为备货 0 分且距离较远，综合评分最低；已为您保留求助记录，到货补发。')
    expect(reply.ok).toBe(true)
    expect(q.status).toBe('replied')
    expect(store.openQuestions.some((x) => x.id === q.id)).toBe(false)
  })

  it('就医提示出路会关闭求助记录；社区短缺复盘按物品聚合未满足需求', () => {
    const store = useMedkitStore()
    store.switchUser('u_g')
    store.apply('i1', 1, 'child_night_fever', 'self_pickup', undefined, nightFactors({ urgency: 'low_fever', hasChild: true, childAge: 10, distanceMeters: 1200 }))
    store.switchUser('u_h')
    store.apply('i1', 1, 'child_night_fever', 'self_pickup', undefined, nightFactors({ urgency: 'child_high_fever', hasChild: true, childAge: 4, temperature: 39.6, distanceMeters: 1800 }))

    store.switchUser('u_v')
    const exec = store.executeAllocation('i1')
    expect(exec.ok).toBe(true)
    const myReq = (uid: string) => store.requests.filter((r) => r.itemId === 'i1' && r.applicantId === uid)[0]
    const high = myReq('u_h')
    expect(high.allocated).toBe(true) // 即使最远，儿童高热仍排第一

    const low = myReq('u_g')
    store.switchUser('u_g')
    const aid = store.chooseAid(low.id, 'medical_advice' as AidRoute)
    expect(aid.ok).toBe(true)
    expect(low.helpStatus).toBe('closed')
    expect(store.openHelpRequests.some((r) => r.id === low.id)).toBe(false)

    // 短缺复盘至少包含 i1 的聚合行
    const group = store.shortageReview.byItem.find((g) => g.itemName.includes('退热贴'))
    expect(group).toBeTruthy()
    expect(group!.closed).toBeGreaterThanOrEqual(1)
  })

  it('不足 2 户同时申请时不能启动分配规则', () => {
    const store = useMedkitStore()
    store.switchUser('u_d')
    store.apply('i1', 1, 'child_night_fever', 'self_pickup', undefined, nightFactors())
    store.switchUser('u_v')
    expect(store.executeAllocation('i1').ok).toBe(false)
  })
})
