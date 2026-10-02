import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '@/App.vue'
import { router } from '@/router'
import { useMedkitStore } from '@/stores/medkit'

let wrapper: VueWrapper | null = null

async function mountApp() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/hall')
  wrapper = mount(App, { global: { plugins: [pinia, router] } })
  await router.isReady()
  return { wrapper, store: useMedkitStore() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

/** 等待懒加载路由组件解析与视图重渲染 */
async function settled() {
  await new Promise((r) => setTimeout(r, 30))
  await new Promise((r) => setTimeout(r, 30))
}

/** 轮询等待断言成立（jsdom 全量加载时懒解析耗时不稳定） */
async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  if (!check()) throw new Error('waitFor 超时')
}

describe('页面冒烟（真实路由 + 角色守卫）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('大厅展示安全横幅并隐藏过期/隔离物品；登记页可正常加载（补历史缺页）', async () => {
    const { wrapper, store } = await mountApp()
    store.switchUser('u_b')
    await router.push('/hall')
    await waitFor(() => wrapper.text().includes('不提供诊断与用药建议'))
    // 过期的 i12 / 隔离物品不出现在大厅
    expect(wrapper.text()).not.toContain('库存遗留')

    await router.push('/register')
    await waitFor(() => wrapper.text().includes('登记共享物品'))
    expect(wrapper.text()).toContain('未开封')
  })

  it('物品详情页可见昨夜夜间分配记录、评分因子与求助记录', async () => {
    const { wrapper } = await mountApp()
    await router.push('/items/i1')
    await waitFor(() => wrapper.text().includes('夜间多人同时申请分配记录'))
    const text = wrapper.text()
    expect(text).toContain('夜间多人同时申请分配记录')
    expect(text).toContain('紧急程度')
    expect(text).toContain('志愿者配送能力')
    expect(text).toContain('赵强')
    expect(text).toContain('郑伟')
    expect(text).toContain('求助记录')
  })

  it('居民被角色守卫拦在工作台外；志愿者可见夜间分配与求助补发；社区可见质疑与复盘', async () => {
    const { wrapper, store } = await mountApp()

    // 居民访问志愿者/社区路由被重定向回大厅
    store.switchUser('u_b')
    await router.push('/volunteer')
    await settled()
    expect(router.currentRoute.value.name).toBe('hall')

    // 志愿者工作台
    store.switchUser('u_v')
    await router.push('/volunteer')
    await waitFor(() => wrapper.text().includes('夜间分配'))
    expect(wrapper.text()).toContain('求助补发')

    // 社区工作台：质疑待答复 + 短缺复盘
    store.switchUser('u_s')
    await router.push('/staff')
    await waitFor(() => wrapper.text().includes('分配理由与质疑'))
    expect(wrapper.text()).toContain('赵强')
    // 切到复盘 tab
    ;(wrapper.findAll('button.chip').find((b) => b.text().includes('夜间短缺复盘'))!.element as HTMLElement).click()
    await waitFor(() => wrapper.text().includes('夜间真实申请户数'))
  })

  it('我的借用：未分到物品的居民（郑伟）能看到求助记录与质疑入口', async () => {
    const { wrapper, store } = await mountApp()
    store.switchUser('u_h')
    await router.push('/my-borrows')
    await waitFor(() => wrapper.text().includes('我的夜间求助记录'))
    expect(wrapper.text()).toContain('对分配结果有疑问')
  })

  it('互助边界页写明夜间多人申请评分规则', async () => {
    const { wrapper } = await mountApp()
    await router.push('/guide')
    await waitFor(() => wrapper.text().includes('紧急程度 40'))
    expect(wrapper.text()).toContain('相邻小区互助')
    expect(wrapper.text()).toContain('就医提示')
  })
})
