import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ItemHallPage from '@/pages/ItemHallPage.vue'
import ItemDetailPage from '@/pages/ItemDetailPage.vue'
import VolunteerPage from '@/pages/VolunteerPage.vue'
import StaffPage from '@/pages/StaffPage.vue'
import MyBorrowsPage from '@/pages/MyBorrowsPage.vue'
import { useMedkitStore } from '@/stores/medkit'

function mountPage(component: unknown, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path, component: component as never }],
  })
  router.push(path)
  return mount(component as never, { global: { plugins: [router] } })
}

describe('夜间分配页面冒烟', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('大厅：安全横幅存在，过期物品隐藏', () => {
    const w = mountPage(ItemHallPage, '/hall')
    expect(w.text()).toContain('不替代就医')
    // i12 已过期，不应出现在大厅
    expect(w.text()).not.toContain('一次性防护口罩（库存遗留）')
  })

  it('物品详情 i13：展示已执行的分配记录、逐户评分理由与未分到居民的求助记录', async () => {
    const store = useMedkitStore()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/items/:id', component: ItemDetailPage }],
    })
    await router.push('/items/i13')
    await router.isReady()
    const w = mount(ItemDetailPage, { global: { plugins: [router] } })
    expect(store.items.some((i) => i.id === 'i13')).toBe(true)
    const text = w.text()
    expect(text).toContain('夜间分配记录与理由')
    expect(text).toContain('张晨')
    expect(text).toContain('李梅')
    expect(text).toContain('已分配（') // 分配到的户
    expect(text).toContain('未分配（') // 未分到的户
    expect(text).toContain('紧急程度')
    expect(text).toContain('待补发') // r10 求助记录
    expect(text).toContain('相邻小区互助') // 出路
  })

  it('志愿者工作台：到货补发页显示挂起的求助记录', async () => {
    const store = useMedkitStore()
    store.switchUser('u_v')
    const w = mountPage(VolunteerPage, '/volunteer')
    await w.findAll('button.chip').find((b) => b.text().includes('到货补发'))!.trigger('click')
    expect(w.text()).toContain('夜间短缺的真实需求')
    expect(w.text()).toContain('周文') // r10 备货类挂起求助
  })

  it('社区工作台：分配理由与质疑页展示理由全文和待答复质疑；短缺复盘可见聚合', async () => {
    const store = useMedkitStore()
    store.switchUser('u_s')
    const w = mountPage(StaffPage, '/staff')
    await w.findAll('button.chip').find((b) => b.text().includes('分配理由与质疑'))!.trigger('click')
    const text1 = w.text()
    expect(text1).toContain('李梅')
    expect(text1).toContain('为什么退热贴先给了')
    expect(text1).toContain('分配理由全文')

    await w.findAll('button.chip').find((b) => b.text().includes('夜间短缺复盘'))!.trigger('click')
    expect(w.text()).toContain('真实需求')
    expect(w.text()).toContain('待到货补发')
  })

  it('我的借用：未分到的居民（周文 u_h）看到求助记录与三条出路', () => {
    const store = useMedkitStore()
    store.switchUser('u_h')
    const w = mountPage(MyBorrowsPage, '/my-borrows')
    const text = w.text()
    expect(text).toContain('求助记录已保留')
    expect(text).toContain('转入相邻小区互助')
    expect(text).toContain('选择替代用品')
    expect(text).toContain('收到就医提示')
    expect(text).toContain('提交质疑')
  })
})
