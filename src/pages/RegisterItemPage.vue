<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import { CATEGORY_LABELS, SCENE_LABELS, STORAGE_LABELS, validateDraft } from '@/rules'
import type { Category, Scene, StorageCondition } from '@/types'
import SafetyBanner from '@/components/SafetyBanner.vue'
import { fmtDate } from '@/utils/date'

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()

const form = reactive<{
  name: string
  category: Category
  spec: string
  expiryDate: string
  storage: StorageCondition
  sealed: boolean
  quantity: number
  location: string
  sceneTags: Scene[]
  note: string
}>({
  name: '',
  category: 'fever_patch',
  spec: '',
  expiryDate: '',
  storage: 'room_temp',
  sealed: true,
  quantity: 1,
  location: '',
  sceneTags: [],
  note: '',
})

const validation = computed(() => validateDraft({ ...form, note: form.note || undefined }, store.nowIso))

function toggleScene(s: Scene) {
  const i = form.sceneTags.indexOf(s)
  if (i >= 0) form.sceneTags.splice(i, 1)
  else form.sceneTags.push(s)
}

function submit() {
  const r = store.register({ ...form, note: form.note || undefined })
  show(r.message, r.ok ? 'ok' : 'err')
  if (r.ok) router.push('/my-shares')
}
</script>

<template>
  <SafetyBanner compact />

  <div class="card">
    <h2 style="margin-bottom: 4px">登记共享物品</h2>
    <div class="muted">
      仅限<strong>未拆封的常备非处方耗材</strong>。处方药 / 口服注射药品、拆封物品、冷链冷藏药品、过期或不足 30 天临期物品，提交即被规则拦截。
      今天是 {{ fmtDate(store.nowIso) }}。
    </div>
  </div>

  <div class="card">
    <label class="field">
      <span>品名</span>
      <input v-model="form.name" type="text" placeholder="如：医用退热贴、碘伏棉片、一次性医用口罩" />
    </label>
    <label class="field">
      <span>品类</span>
      <select v-model="form.category">
        <option v-for="[k, v] in Object.entries(CATEGORY_LABELS)" :key="k" :value="k">{{ v }}</option>
      </select>
    </label>
    <label class="field">
      <span>规格</span>
      <input v-model="form.spec" type="text" placeholder="如 4贴/盒、50只/盒、LR41 2粒/板" />
    </label>
    <label class="field">
      <span>有效期至</span>
      <input v-model="form.expiryDate" type="date" />
    </label>
    <label class="field">
      <span>存放条件</span>
      <select v-model="form.storage">
        <option value="room_temp">{{ STORAGE_LABELS.room_temp }}</option>
        <option value="cool_dry">{{ STORAGE_LABELS.cool_dry }}</option>
        <option value="refrigerate">{{ STORAGE_LABELS.refrigerate }}（禁入共享）</option>
      </select>
    </label>
    <label class="check-row">
      <input type="checkbox" v-model="form.sealed" />
      <span>我确认物品为整盒/整包<strong>未开封</strong>，封签完好（拆封物品不能进入共享）</span>
    </label>
    <label class="field">
      <span>可借数量</span>
      <input v-model.number="form.quantity" type="number" min="1" max="999" />
    </label>
    <label class="field">
      <span>取用地点</span>
      <input v-model="form.location" type="text" placeholder="如 3号楼1单元门口共享柜 A格" />
    </label>
    <div class="field">
      <span>适用场景（可多选）</span>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px">
        <label v-for="[k, v] in Object.entries(SCENE_LABELS)" :key="k" class="chip" :class="{ active: form.sceneTags.includes(k as Scene) }">
          <input type="checkbox" :checked="form.sceneTags.includes(k as Scene)" @change="toggleScene(k as Scene)" style="margin-right: 4px" />{{ v }}
        </label>
      </div>
    </div>
    <label class="field">
      <span>给邻居的留言（可选）</span>
      <textarea v-model="form.note" placeholder="如：家里备多了，未拆封，夜间急用可先取"></textarea>
    </label>

    <div v-for="(e, i) in validation.errors" :key="`e${i}`" class="banner banner-danger">⛔ {{ e }}</div>
    <div v-for="(w, i) in validation.warnings" :key="`w${i}`" class="banner banner-warn">⚠️ {{ w }}</div>

    <div class="card-actions">
      <button class="btn btn-primary" :disabled="validation.errors.length > 0" @click="submit">提交志愿者审核</button>
      <button class="btn" @click="router.push('/hall')">取消</button>
    </div>
  </div>
</template>
