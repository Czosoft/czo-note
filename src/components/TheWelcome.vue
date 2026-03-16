<script setup>
import { ref } from 'vue'
import WelcomeItem from './WelcomeItem.vue'
import DocumentationIcon from './icons/IconDocumentation.vue'
import ToolingIcon from './icons/IconTooling.vue'
import EcosystemIcon from './icons/IconEcosystem.vue'
import CommunityIcon from './icons/IconCommunity.vue'
import SupportIcon from './icons/IconSupport.vue'

const openReadmeInEditor = () => fetch('/__open-in-editor?file=README.md')

const copyMessage = ref('')
let copyTimeout = null

const copyToClipboard = (text) => {
  const handleSuccess = () => {
    copyMessage.value = '已复制: ' + text
    if (copyTimeout) clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => {
      copyMessage.value = ''
    }, 2000)
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(handleSuccess).catch(err => {
      console.error('Clipboard API failed: ', err)
      fallbackCopyTextToClipboard(text, handleSuccess)
    })
  } else {
    fallbackCopyTextToClipboard(text, handleSuccess)
  }
}

const fallbackCopyTextToClipboard = (text, callback) => {
  const textArea = document.createElement('textarea')
  textArea.value = text
  
  // 确保 textarea 不可见且不影响布局
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '0'
  document.body.appendChild(textArea)
  
  textArea.focus()
  textArea.select()

  try {
    const successful = document.execCommand('copy')
    if (successful) {
      callback()
    } else {
      console.error('Fallback copy failed')
    }
  } catch (err) {
    console.error('Fallback copy error: ', err)
  }

  document.body.removeChild(textArea)
}

const environments = [
  {
    name: '名称',
    url: 'http://url',
    accounts: [
      { type: '管理端', username: '测试用户名', password: '测试密码' },
      { type: '客户端', username: '测试用户名', password: '测试密码' }
    ]
  },
  {
    name: '名称',
    url: 'http://url',
    accounts: [
      { type: '管理端', username: '测试用户名', password: '测试密码' },
      { type: '客户端', username: '测试用户名', password: '测试密码' }
    ]
  }
]
</script>

<template>
  <WelcomeItem>
    <template #icon>
      <EcosystemIcon />
    </template>
    <template #heading>入口</template>

    <div v-for="env in environments" :key="env.name" style="margin-bottom: 20px;">
      {{ env.name }}:
      <a :href="env.url" target="_blank" rel="noopener">{{ env.url }}</a>
      <div v-for="account in env.accounts" :key="account.type" style="margin-top: 10px;">
        {{ account.type }}:
        <br />
        用户名: 
        <span @click="copyToClipboard(account.username)" style="cursor: pointer; color: var(--vt-c-indigo);">{{ account.username }}</span>
        <br />
        密码: 
        <span @click="copyToClipboard(account.password)" style="cursor: pointer; color: var(--vt-c-indigo);">{{ account.password }}</span>
      </div>
    </div>
    <div v-if="copyMessage" style="position: fixed; top: 20px; right: 20px; background: #42b883; color: white; padding: 10px 20px; border-radius: 4px; z-index: 9999; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.1);">
      {{ copyMessage }}
    </div>
  </WelcomeItem>

  <WelcomeItem>
    <template #icon>
      <DocumentationIcon />
    </template>
    <template #heading>Documentation</template>

    Vue’s
    <a href="https://vuejs.org/" target="_blank" rel="noopener">official documentation</a>
    provides you with all information you need to get started.
  </WelcomeItem>

  <WelcomeItem>
    <template #icon>
      <ToolingIcon />
    </template>
    <template #heading>Tooling</template>

    This project is served and bundled with
    <a href="https://vite.dev/guide/features.html" target="_blank" rel="noopener">Vite</a>. The
    recommended IDE setup is
    <a href="https://code.visualstudio.com/" target="_blank" rel="noopener">VSCode</a>
    +
    <a href="https://github.com/vuejs/language-tools" target="_blank" rel="noopener"
      >Vue - Official</a
    >. If you need to test your components and web pages, check out
    <a href="https://vitest.dev/" target="_blank" rel="noopener">Vitest</a>
    and
    <a href="https://www.cypress.io/" target="_blank" rel="noopener">Cypress</a>
    /
    <a href="https://playwright.dev/" target="_blank" rel="noopener">Playwright</a>.

    <br />

    More instructions are available in
    <a href="javascript:void(0)" @click="openReadmeInEditor"><code>README.md</code></a
    >.
  </WelcomeItem>

  <WelcomeItem>
    <template #icon>
      <EcosystemIcon />
    </template>
    <template #heading>Ecosystem</template>

    Get official tools and libraries for your project:
    <a href="https://pinia.vuejs.org/" target="_blank" rel="noopener">Pinia</a>,
    <a href="https://router.vuejs.org/" target="_blank" rel="noopener">Vue Router</a>,
    <a href="https://test-utils.vuejs.org/" target="_blank" rel="noopener">Vue Test Utils</a>, and
    <a href="https://github.com/vuejs/devtools" target="_blank" rel="noopener">Vue Dev Tools</a>. If
    you need more resources, we suggest paying
    <a href="https://github.com/vuejs/awesome-vue" target="_blank" rel="noopener">Awesome Vue</a>
    a visit.
  </WelcomeItem>

  <WelcomeItem>
    <template #icon>
      <CommunityIcon />
    </template>
    <template #heading>Community</template>

    Got stuck? Ask your question on
    <a href="https://chat.vuejs.org" target="_blank" rel="noopener">Vue Land</a>
    (our official Discord server), or
    <a href="https://stackoverflow.com/questions/tagged/vue.js" target="_blank" rel="noopener"
      >StackOverflow</a
    >. You should also follow the official
    <a href="https://bsky.app/profile/vuejs.org" target="_blank" rel="noopener">@vuejs.org</a>
    Bluesky account or the
    <a href="https://x.com/vuejs" target="_blank" rel="noopener">@vuejs</a>
    X account for latest news in the Vue world.
  </WelcomeItem>

  <WelcomeItem>
    <template #icon>
      <SupportIcon />
    </template>
    <template #heading>Support Vue</template>

    As an independent project, Vue relies on community backing for its sustainability. You can help
    us by
    <a href="https://vuejs.org/sponsor/" target="_blank" rel="noopener">becoming a sponsor</a>.
  </WelcomeItem>
</template>
