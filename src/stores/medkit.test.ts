import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMedkitStore } from '@/stores/medkit'
import { BASE_NOW } from '@/data/seed'
import { addHours } from '@/utils/date'

function freshStore() {
  localStorage.clear()
  setActivePinia(createPinia())
  return useMedkitStore()
}

describe('种子数据：昨夜多户同时申请退热贴的批次', () => {
  it('5 户申请、3 户分到；赵强被运力卡住转互助、郑伟库存不足保留求助', () => {
    const s = freshStore()
    const b = s.batches.find((x) => x.id === 'b1')!
    expect(b).toBeTruthy()
    expect(b.executedAt).toBeTruthy()
    expect(b.decisions).toHaveLength(5)
    expect(b.stockQty).toBe(3)
    expect(b.deliveryCapacity).toBe(2)

    const allocated = b.decisions.filter((d) => d.suggestion === 'allocate')
    expect(allocated.map((d) => d.applicantName).sort()).toEqual(['吴芳', '张莉', '刘梅'].sort())

    const zhao = b.decisions.find((d) => d.applicantId === 'u_f')!
    expect(zhao.capacityBlocked).toBe(true)
    expect(zhao.suggestion).toBe('mutual_aid')
    expect(zhao.factors.find((f) => f.key === 'capacity')!.detail).toContain('运力')
    const zheng = b.decisions.find((d) => d.applicantId === 'u_h')!
    expect(zheng.allocatedQty).toBe(0)
    expect(zheng.capacityBlocked).toBe(false)
    expect(zheng.reasons.join(' ')).toContain('库存')
    // 即使首选建议是去相邻小区，求助仍保留到货补发路径
    expect(zheng.fallbackOptions.join(' ')).toContain('补发')

    // 每一户都有留痕理由（社区据此答复质疑）
    for (const d of b.decisions) expect(d.reasons.length).toBeGreaterThan(0)

    // 求助记录保留：赵强已转互助、郑伟仍待跟进
    const h1 = s.helpRecords.find((h) => h.id === 'h1')!
    expect(h1.status).toBe('mutual_aid_transfer')
    expect(h1.mutualAidCommunity).toBe('安康苑小区')
    const h2 = s.helpRecords.find((h) => h.id === 'h2')!
    expect(h2.status).toBe('pending')

    // 质疑待答复
    expect(s.openDisputes.map((d) => d.id)).toContain('dp1')

    // 时间线包含分配/求助/就医提示/质疑事件
    const kinds = s.itemTimeline('i1').map((e) => e.kind)
    expect(kinds).toContain('allocation_suggested')
    expect(kinds).toContain('allocated')
    expect(kinds).toContain('help_created')
    expect(kinds).toContain('help_mutual_aid')
    expect(kinds).toContain('medical_tip')
    expect(kinds).toContain('dispute_opened')
  })

  it('夜间短缺复盘统计真实需求与去向', () => {
    const s = freshStore()
    const row = s.shortageReview[0]
    expect(row.total).toBe(5)
    expect(row.allocated).toBe(3)
    expect(row.unmet).toBe(2)
    expect(row.capacityBlocked).toBe(1)
    expect(row.criticalUnmet).toBe(1)
    expect(row.byMutualAid).toBe(1)
    expect(row.pending).toBe(1)
  })
})

describe('夜间分配完整流程（现场演示路径）', () => {
  beforeEach(() => {
    freshStore()
  })

  /** 登记一件新的退热贴并审核通过，返回物品 id */
  function registerFeverPatch(stock: number): string {
    const s = useMedkitStore()
    s.switchUser('u_a')
    const r = s.register(
      {
        name: '医用退热贴',
        category: 'fever_patch',
        spec: '4贴/盒',
        expiryDate: addHours(BASE_NOW, 180 * 24).slice(0, 10),
        storage: 'cool_dry',
        sealed: true,
        quantity: stock,
        location: '3号楼1单元共享柜',
        sceneTags: ['child_night_fever'],
      },
    )
    expect(r.ok).toBe(true)
    const id = s.items[0].id
    s.switchUser('u_v')
    expect(s.reviewItem(id, true).ok).toBe(true)
    return id
  }

  it('夜间多户申请 → 权限校验 → 生成建议 → 执行；运力卡住的家庭转求助并可走相邻小区互助', () => {
    const s = useMedkitStore()
    const itemId = registerFeverPatch(3)
    s.advanceHours(12) // 09:00 → 21:00 夜间
    expect(s.nowIso).toBe(addHours(BASE_NOW, 12))
    // 种子里 r5 仍在志愿者配送中，当晚剩余代送名额 = 2 - 1 = 1
    expect(s.nightDeliveryCapacity()).toBe(1)

    // 三户夜间几乎同时申请：吴芳门口交接（较急）、赵强/刘梅代送（紧急）
    s.switchUser('u_g')
    expect(s.apply(itemId, 1, 'child_night_fever', 'door_contactless', { urgency: 'urgent', hasChild: true, symptom: '38.5℃' }).ok).toBe(true)
    s.switchUser('u_h')
    const second = s.apply(itemId, 1, 'child_night_fever', 'volunteer_delivery', { urgency: 'critical', hasChild: true, symptom: '39.4℃' })
    expect(second.message).toContain('评分')
    s.switchUser('u_f')
    expect(s.apply(itemId, 1, 'child_night_fever', 'volunteer_delivery', { urgency: 'critical', hasChild: true, symptom: '39.5℃ 寒战' }).ok).toBe(true)

    expect(s.nightConcurrent(itemId)).toHaveLength(3)

    // 居民无权生成建议
    expect(s.generateAllocationBatch(itemId).ok).toBe(false)
    s.switchUser('u_v')
    const gen = s.generateAllocationBatch(itemId)
    expect(gen.ok).toBe(true)
    const batchId = gen.batchId!
    const batch = s.batches.find((b) => b.id === batchId)!
    // 两户紧急（赵强更近）排在吴芳之前
    expect(batch.decisions[0].applicantId).toBe('u_f')

    const exec = s.executeAllocation(batchId)
    expect(exec.ok).toBe(true)
    // 赵强（代送）占掉仅有的 1 个名额；刘梅分数够但运力被卡 → 求助；吴芳门口交接不受运力影响
    const byUser = new Map(batch.decisions.map((d) => [d.applicantId, d]))
    expect(byUser.get('u_f')!.suggestion).toBe('allocate')
    expect(byUser.get('u_g')!.suggestion).toBe('allocate')
    expect(byUser.get('u_h')!.suggestion).toBe('mutual_aid')
    expect(byUser.get('u_h')!.capacityBlocked).toBe(true)
    // 实际锁定 2 盒
    expect(s.availableQty(itemId)).toBe(1)
    // 未中家庭自动生成求助记录
    const help = s.helpRecords.find((h) => h.applicantId === 'u_h' && h.batchId === batchId)!
    expect(help.status).toBe('pending')
    // 志愿者协调相邻小区互助后闭环
    expect(s.transferToMutualAid(help.id, 'mp1').ok).toBe(true)
    expect(help.status).toBe('mutual_aid_transfer')
    // 批次不可重复执行
    expect(s.executeAllocation(batchId).ok).toBe(false)
  })

  it('非夜间时段或不足 2 户不能生成夜间分配建议', () => {
    const s = useMedkitStore()
    const itemId = registerFeverPatch(2)
    // 白天不能
    expect(s.generateAllocationBatch(itemId).ok).toBe(false)
    s.advanceHours(12) // 21:00
    s.switchUser('u_g')
    s.apply(itemId, 1, 'child_night_fever', 'self_pickup', { urgency: 'urgent', hasChild: true })
    s.switchUser('u_v')
    // 只有 1 户不能
    expect(s.generateAllocationBatch(itemId).ok).toBe(false)
    s.switchUser('u_h')
    s.apply(itemId, 1, 'child_night_fever', 'self_pickup', { urgency: 'normal', hasChild: true })
    s.switchUser('u_v')
    expect(s.generateAllocationBatch(itemId).ok).toBe(true)
  })

  it('种子待跟进求助 h2：释放超时占用的库存后安排补发并完成闭环', () => {
    const s = useMedkitStore()
    const h2 = s.helpRecords.find((h) => h.id === 'h2')!
    expect(h2.status).toBe('pending')
    s.switchUser('u_v')
    // 当前 i1 余量 0（总量 4：r3 锁 1、昨夜 3 户已取走待闭环），不能补发
    expect(s.availableQty('i1')).toBe(0)
    expect(s.arrangeBackfill('h2').ok).toBe(false)
    // 取消超时占着库存的 r3，释放 1 盒
    expect(s.cancelRequest('r3', '超时未取，释放给夜间求助补发', { bySystem: true }).ok).toBe(true)
    expect(s.availableQty('i1')).toBe(1)
    expect(s.arrangeBackfill('h2').ok).toBe(true)
    expect(h2.backfillRequestId).toBeTruthy()
    expect(s.availableQty('i1')).toBe(0)
    expect(s.completeBackfill('h2').ok).toBe(true)
    expect(h2.status).toBe('backfilled')
  })

  it('转相邻小区互助会扣减对方库存并闭环求助', () => {
    const s = useMedkitStore()
    s.switchUser('u_v')
    const before = s.mutualAidPoints.find((p) => p.id === 'mp1')!.stocks[0].quantity
    expect(s.transferToMutualAid('h2', 'mp1').ok).toBe(true)
    const after = s.mutualAidPoints.find((p) => p.id === 'mp1')!.stocks[0].quantity
    expect(after).toBe(before - 1)
    expect(s.helpRecords.find((h) => h.id === 'h2')!.status).toBe('mutual_aid_transfer')
  })

  it('居民提出质疑 → 工作人员答复时附评分理由', () => {
    const s = useMedkitStore()
    // 工作人员答复种子里赵强的质疑
    s.switchUser('u_s')
    expect(s.replyDispute('dp1', '已核对评分：您家被夜间运力卡住，已协调安康苑互助并保留补发资格。').ok).toBe(true)
    const dp = s.disputes.find((d) => d.id === 'dp1')!
    expect(dp.status).toBe('replied')
    expect(dp.reply).toContain('运力')
    // 非工作人员不能答复
    s.switchUser('u_v')
    expect(s.replyDispute('dp1', 'x').ok).toBe(false)

    // 郑伟对自己的 h2 提质疑；其他人不能代提
    s.switchUser('u_h')
    expect(s.openDispute('h2', '我家也有孩子为什么没分到').ok).toBe(true)
    expect(s.openDisputes.some((d) => d.applicantId === 'u_h')).toBe(true)
    s.switchUser('u_d')
    expect(s.openDispute('h2', 'xxx').ok).toBe(false)
  })

  it('就医提示不闭环求助；改选替代用品锁定替代品库存；已结束的求助不能再补发', () => {
    const s = useMedkitStore()
    s.switchUser('u_v')
    expect(s.sendMedicalTip('h2', '请立即就医').ok).toBe(true)
    expect(s.helpRecords.find((h) => h.id === 'h2')!.status).toBe('pending')

    const before = s.availableQty('i13')
    expect(s.chooseAlternative('h2', 'i13').ok).toBe(true)
    expect(s.availableQty('i13')).toBe(before - 1)
    expect(s.helpRecords.find((h) => h.id === 'h2')!.status).toBe('alternative')
    expect(s.arrangeBackfill('h2').ok).toBe(false)
  })

  it('居民可自行关闭求助，记录仍保留用于复盘', () => {
    const s = useMedkitStore()
    s.switchUser('u_h')
    expect(s.closeHelp('h2', '已自行买到').ok).toBe(true)
    const h = s.helpRecords.find((x) => x.id === 'h2')!
    expect(h.status).toBe('closed')
    // 复盘统计仍包含该批次 5 户
    expect(s.shortageReview[0].total).toBe(5)
  })
})

describe('申请携带夜间分配因子', () => {
  it('apply 记录紧急度/儿童/距离', () => {
    const s = freshStore()
    s.switchUser('u_f') // 6 号楼
    expect(s.apply('i2', 1, 'home_care', 'self_pickup', { urgency: 'urgent', hasChild: false }).ok).toBe(true)
    const req = s.requests.find((x) => x.itemId === 'i2' && x.applicantId === 'u_f')!
    expect(req.urgency).toBe('urgent')
    expect(req.hasChild).toBe(false)
    // 6 号楼到 5 号楼：60 + 90 = 150 米
    expect(req.distanceMeters).toBe(150)
  })
})
