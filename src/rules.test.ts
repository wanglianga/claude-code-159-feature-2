import { describe, expect, it } from 'vitest'
import { isNightTime, validateDraft } from '@/rules'
import { addDays } from '@/utils/date'
import type { ItemDraft } from '@/types'

const NOW = '2026-09-27T09:00:00'

function draft(over: Partial<ItemDraft> = {}): ItemDraft {
  return {
    name: '医用退热贴',
    category: 'fever_patch',
    spec: '4贴/盒',
    expiryDate: addDays(NOW, 180).slice(0, 10),
    storage: 'room_temp',
    sealed: true,
    quantity: 2,
    location: '3号楼1单元共享柜',
    sceneTags: ['child_night_fever'],
    ...over,
  }
}

describe('禁入规则 validateDraft', () => {
  it('合规物品无错误', () => {
    expect(validateDraft(draft(), NOW).errors).toEqual([])
  })

  it.each(['布洛芬', '对乙酰氨基酚', '头孢克肟胶囊', '抗生素注射液', '降压药片'])('口服/处方药关键词禁入：%s', (name) => {
    const { errors } = validateDraft(draft({ name }), NOW)
    expect(errors.join(' ')).toContain('处方药')
  })

  it('拆封物品禁入', () => {
    expect(validateDraft(draft({ sealed: false }), NOW).errors.join(' ')).toContain('拆封')
  })

  it('冷链物品禁入', () => {
    expect(validateDraft(draft({ storage: 'refrigerate' }), NOW).errors.join(' ')).toContain('冷链')
  })

  it('过期禁入；≤30 天、≤60 天分别红/黄预警', () => {
    expect(validateDraft(draft({ expiryDate: addDays(NOW, -1).slice(0, 10) }), NOW).errors.join(' ')).toContain('已过期')
    expect(validateDraft(draft({ expiryDate: addDays(NOW, 20).slice(0, 10) }), NOW).warnings.join(' ')).toContain('30 天')
    expect(validateDraft(draft({ expiryDate: addDays(NOW, 50).slice(0, 10) }), NOW).warnings.join(' ')).toContain('60 天')
  })

  it('数量异常与必填校验', () => {
    expect(validateDraft(draft({ quantity: 0 }), NOW).errors.join(' ')).toContain('大于 0')
    expect(validateDraft(draft({ quantity: 1000 }), NOW).errors.join(' ')).toContain('数量异常')
    expect(validateDraft(draft({ name: '  ' }), NOW).errors.length).toBeGreaterThan(0)
  })

  it('其他耗材需要双重复核提示', () => {
    expect(validateDraft(draft({ category: 'other_consumable' }), NOW).warnings.join(' ')).toContain('双重')
  })
})

describe('夜间时段判定', () => {
  it('20:00 至次日 06:00 为夜间', () => {
    expect(isNightTime('2026-09-27T20:00:00')).toBe(true)
    expect(isNightTime('2026-09-27T01:30:00')).toBe(true)
    expect(isNightTime('2026-09-27T05:59:00')).toBe(true)
    expect(isNightTime('2026-09-27T06:00:00')).toBe(false)
    expect(isNightTime('2026-09-27T09:00:00')).toBe(false)
    expect(isNightTime('2026-09-27T19:59:00')).toBe(false)
  })
})
