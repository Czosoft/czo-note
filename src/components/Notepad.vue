<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'
import MarkdownItKatex from 'markdown-it-katex'
import mermaid from 'mermaid'
import draggable from 'vuedraggable'
import html2pdf from 'html2pdf.js'
import html2canvas from 'html2canvas'
import HTMLtoDOCX from 'html-to-docx'
import { saveAs } from 'file-saver'
import { Buffer } from 'buffer'
import QRCode from 'qrcode'

if (typeof window !== 'undefined') {
  window.Buffer = Buffer
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true
}).use(MarkdownItKatex)

// Mermaid 初始化
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
})

const renderMermaid = async (id, code) => {
  try {
    const { svg } = await mermaid.render(id, code)
    return svg
  } catch (error) {
    console.error('Mermaid render error:', error)
    return `<pre>${code}</pre>`
  }
}

// 扩展 markdown-it 渲染规则
const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  if (info === 'mermaid') {
    // 明确禁用 HTML 转义，因为 mermaid 需要原始文本
    return `<div class="mermaid">${token.content}</div>`
  }
  return defaultFence(tokens, idx, options, env, self)
}

// 自动识别以 mermaid 关键字开头的代码块（即使没有 ```mermaid 标记）
const defaultParagraph = md.renderer.rules.paragraph_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
  const nextToken = tokens[idx + 1]
  if (nextToken && nextToken.type === 'inline') {
    const content = nextToken.content.trim()
    const mermaidKeywords = ['sequenceDiagram', 'graph ', 'graph\n', 'flowchart', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram']
    if (mermaidKeywords.some(keyword => content.startsWith(keyword))) {
      // 这是一个潜在的 mermaid 块，但不属于 fence。
      // 我们将其内容标记为 mermaid
      nextToken.isMermaid = true
      return '<div class="mermaid">'
    }
  }
  return defaultParagraph(tokens, idx, options, env, self)
}

const defaultParagraphClose = md.renderer.rules.paragraph_close || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.paragraph_close = (tokens, idx, options, env, self) => {
  if (tokens[idx - 1] && tokens[idx - 1].isMermaid) {
    return '</div>'
  }
  return defaultParagraphClose(tokens, idx, options, env, self)
}

// 状态定义
const notes = ref([])
const activeId = ref(null)
const searchQuery = ref('')
const showShareModal = ref(false)
const shareIp = ref('')
const sharePort = ref(window.location.port || (window.location.protocol === 'https:' ? '443' : '80'))
const qrCodeImg = ref('')

// API 地址：使用相对路径以支持 Vite 代理
const API_BASE = '/api'

// 从数据库加载笔记
const fetchNotes = async () => {
  try {
    const savedUser = localStorage.getItem('currentUser')
    const user = savedUser ? JSON.parse(savedUser) : null
    let url = `${API_BASE}/notes`
    const params = new URLSearchParams()
    
    if (user) {
      params.append('userId', user.id)
      if (user.isSubUser && user.permissions) {
        params.append('permissions', user.permissions)
      }
    }
    
    if (params.toString()) {
      url += '?' + params.toString()
    }
    
    const response = await fetch(url)
    if (response.ok) {
      const data = await response.json()
      notes.value = data
      
      // 默认选中
      const urlParams = new URLSearchParams(window.location.search)
      const noteIdFromUrl = urlParams.get('noteId')
      
      if (noteIdFromUrl) {
        activeId.value = parseInt(noteIdFromUrl)
      } else if (notes.value.length > 0 && !activeId.value) {
        activeId.value = notes.value[0].id
      }
    }
  } catch (error) {
    console.error('Failed to fetch notes:', error)
    // 降级使用 localStorage
    const savedNotes = localStorage.getItem('notes')
    if (savedNotes) {  savedNotes
      notes.value = JSON.parse(savedNotes)
    }
  }
}

onMounted(() => {
  fetchNotes()
})

// 保存防抖控制
let saveTimeout = null
const saveStatus = ref('saved') // 'saved', 'saving', 'error'

const syncNotesToDb = () => {
  const savedUser = localStorage.getItem('currentUser')
  const user = savedUser ? JSON.parse(savedUser) : null

  if (saveTimeout) clearTimeout(saveTimeout)
  saveStatus.value = 'saving'
  saveTimeout = setTimeout(async () => {
    try {
      // 在子账户模式下，增加本地权限预检查
      if (user && user.isSubUser && user.permissions) {
        let allowedIds = user.permissions;
        if (typeof allowedIds === 'string') {
          try { allowedIds = JSON.parse(allowedIds); } catch(e) { allowedIds = []; }
        }
        
        if (Array.isArray(allowedIds)) {
          // 检查当前笔记是否在授权范围内
          const hasUnauthorizedChange = notes.value.some(note => {
            const isAllowed = allowedIds.includes(Number(note.id)) || allowedIds.includes(String(note.id));
            return !isAllowed;
          });
          
          if (hasUnauthorizedChange) {
            console.warn('Attempted to sync unauthorized notes, they will be filtered by server.');
          }
        }
      }

      const response = await fetch(`${API_BASE}/notes/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          notes: notes.value,
          userId: user ? user.id : 1,
          isSubUser: user ? user.isSubUser : false,
          permissions: user ? user.permissions : null,
          subPasswordId: user ? user.subPasswordId : null
        })
      })
      
      if (!response.ok) {
        throw new Error('Sync failed')
      }
      
      saveStatus.value = 'saved'
      // 同时备份到 localStorage
      localStorage.setItem('notes', JSON.stringify(notes.value))
    } catch (error) {
      console.error('Failed to sync notes:', error)
      saveStatus.value = 'error'
      localStorage.setItem('notes', JSON.stringify(notes.value))
    }
  }, 1000) // 增加到 1s 防抖，减少请求频率
}

// 监听 notes 变化并保存
watch(notes, () => {
  syncNotesToDb()
}, { deep: true })

// 当前选中的笔记
const activeNote = computed(() => {
  return notes.value.find(note => note.id === activeId.value) || null
})

// 检查笔记是否在当前用户的授权范围内
const currentUser = computed(() => {
  const savedUser = localStorage.getItem('currentUser')
  return savedUser ? JSON.parse(savedUser) : null
})

const isNoteAuthorized = (noteId) => {
  const user = currentUser.value
  if (!user || !user.isSubUser) return true // 主账户或未登录视为有权（主账户校验在后端）
  if (!user.permissions) return false
  
  let allowedIds = user.permissions
  if (typeof allowedIds === 'string') {
    try { allowedIds = JSON.parse(allowedIds); } catch(e) { allowedIds = []; }
  }
  
  return Array.isArray(allowedIds) && (allowedIds.includes(Number(noteId)) || allowedIds.includes(String(noteId)))
}

// 搜索后的笔记列表（用于显示，如果是搜索状态，拖拽可能不直观，但我们依然允许）
const filteredNotes = computed({
  get() {
    if (!searchQuery.value) return notes.value
    return notes.value.filter(note => 
      note.title.toLowerCase().includes(searchQuery.value.toLowerCase()) || 
      note.content.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
  },
  set(newValue) {
    // 当拖拽发生时，我们需要更新 notes.value
    if (!searchQuery.value) {
      notes.value = newValue
    } else {
      // 如果是在搜索结果中拖拽，处理逻辑会比较复杂，
      // 这里简单处理：将当前搜索结果在原数组中的位置进行替换
      const newNotes = [...notes.value]
      const filtered = notes.value.filter(note => 
        note.title.toLowerCase().includes(searchQuery.value.toLowerCase()) || 
        note.content.toLowerCase().includes(searchQuery.value.toLowerCase())
      )
      
      // 找到搜索结果中每个项在原数组中的索引
      const indices = filtered.map(f => notes.value.findIndex(n => n.id === f.id))
      // 按照排序后的顺序放回原数组
      newValue.forEach((item, i) => {
        newNotes[indices[i]] = item
      })
      notes.value = newNotes
    }
  }
})

// Markdown 预览
const renderedMarkdown = ref('')
const updatePreview = async () => {
  if (!activeNote.value) {
    renderedMarkdown.value = ''
    return
  }
  
  const rawHtml = md.render(activeNote.value.content)
  renderedMarkdown.value = rawHtml

  await nextTick()

  const mermaidDivs = document.querySelectorAll('.markdown-preview .mermaid')
  for (let i = 0; i < mermaidDivs.length; i++) {
    const div = mermaidDivs[i]
    // 使用 dataset 存储原始代码，防止重复渲染或 textContent 被修改
    const code = div.dataset.processed ? div.dataset.code : div.textContent
    if (!code) continue

    const id = `mermaid-svg-${Date.now()}-${i}`
    try {
      // 存储原始代码
      if (!div.dataset.processed) {
        div.dataset.code = code
        div.dataset.processed = 'true'
      }
      const { svg } = await mermaid.render(id, code)
      div.innerHTML = svg
    } catch (e) {
      console.error('Mermaid render error:', e)
      div.innerHTML = `<pre style="color:red; font-size: 12px; white-space: pre-wrap;">Mermaid Error: ${e.message}</pre>`
      // 清除可能生成的错误元素，mermaid 有时会在 body 末尾留下错误提示
      const errorSvg = document.getElementById(id)
      if (errorSvg) errorSvg.remove()
    }
  }
}

watch(() => activeNote.value?.content, () => {
  updatePreview()
}, { immediate: true })

// 功能函数
const createNewNote = () => {
  if (currentUser.value && currentUser.value.isSubUser) {
    alert('子账户无权创建新笔记，请联系主账户授权。')
    return
  }
  const id = Date.now()
  const newNote = {
    id,
    title: '未命名笔记',
    content: '',
    createdAt: id,
    updatedAt: id,
    startDate: '',
    endDate: ''
  }
  notes.value.unshift(newNote)
  activeId.value = id
}

const deleteNote = async (id) => {
  if (confirm('确定删除这条笔记吗？')) {
    try {
      const savedUser = localStorage.getItem('currentUser')
      const user = savedUser ? JSON.parse(savedUser) : null
      
      const params = new URLSearchParams()
      if (user) {
        params.append('userId', user.id)
        params.append('isSubUser', user.isSubUser || false)
        if (user.subPasswordId) params.append('subPasswordId', user.subPasswordId)
        if (user.permissions) params.append('permissions', JSON.stringify(user.permissions))
      }

      const response = await fetch(`${API_BASE}/notes/${id}?${params.toString()}`, {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Delete failed')
      }

      const index = notes.value.findIndex(note => note.id === id)
      if (index !== -1) {
        notes.value.splice(index, 1)
        if (activeId.value === id) {
          activeId.value = notes.value.length > 0 ? notes.value[0].id : null
        }
      }
    } catch (error) {
      alert('删除失败: ' + error.message)
      console.error('Delete error:', error)
    }
  }
}

const selectNote = (id) => {
  activeId.value = id
}

const handleInput = () => {
  if (activeNote.value) {
    activeNote.value.updatedAt = Date.now()
    // 自动更新标题：如果标题没被改过（还是'未命名笔记'），则用内容前20个字符
    if ((!activeNote.value.title || activeNote.value.title === '未命名笔记') && activeNote.value.content.trim()) {
      activeNote.value.title = activeNote.value.content.trim().split('\n')[0].substring(0, 20)
    }
  }
}

const handleDateChange = () => {
  if (activeNote.value) {
    activeNote.value.updatedAt = Date.now()
    
    const formatDateToDot = (dateStr) => {
      if (!dateStr) return ''
      return dateStr.replace(/-/g, '.')
    }

    const title = activeNote.value.title || ''
    const isDefaultTitle = !title || title === '未命名笔记'

    if (isDefaultTitle) {
      // 如果标题为空或者是默认的“未命名笔记”，根据当前选择的日期填充
      const start = formatDateToDot(activeNote.value.startDate)
      const end = formatDateToDot(activeNote.value.endDate)
      
      if (start && end) {
        activeNote.value.title = `${start}-${end}周报`
      } else if (start) {
        activeNote.value.title = `${start}-周报`
      } else if (end) {
        activeNote.value.title = `-${end}周报`
      }
    } else {
      // 检查是否符合 yyyy.MM.dd-yyyy.MM.dd周报 格式
      const fullPattern = /^(\d{4}\.\d{2}\.\d{2})-(\d{4}\.\d{2}\.\d{2})周报$/
      const fullMatch = title.match(fullPattern)
      
      if (fullMatch) {
        const start = formatDateToDot(activeNote.value.startDate) || fullMatch[1]
        const end = formatDateToDot(activeNote.value.endDate) || fullMatch[2]
        activeNote.value.title = `${start}-${end}周报`
      } else {
        // 检查是否符合 yyyy.MM.dd-周报 或 -yyyy.MM.dd周报 格式
        const startOnlyPattern = /^(\d{4}\.\d{2}\.\d{2})-周报$/
        const endOnlyPattern = /^-(\d{4}\.\d{2}\.\d{2})周报$/
        
        const startMatch = title.match(startOnlyPattern)
        const endMatch = title.match(endOnlyPattern)
        
        if (startMatch) {
          const start = formatDateToDot(activeNote.value.startDate) || startMatch[1]
          const end = formatDateToDot(activeNote.value.endDate)
          if (end) {
            activeNote.value.title = `${start}-${end}周报`
          } else {
            activeNote.value.title = `${start}-周报`
          }
        } else if (endMatch) {
          const start = formatDateToDot(activeNote.value.startDate)
          const end = formatDateToDot(activeNote.value.endDate) || endMatch[1]
          if (start) {
            activeNote.value.title = `${start}-${end}周报`
          } else {
            activeNote.value.title = `-${end}周报`
          }
        }
      }
    }
  }
}

const formatDate = (timestamp) => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

// 拖拽调整编辑器宽度
const editorPaneWidth = ref(50) // 百分比
const isDragging = ref(false)

// 拖拽调整侧边栏宽度
const sidebarWidth = ref(300) // 像素
const isSidebarDragging = ref(false)

const startResizing = (e) => {
  isDragging.value = true
  // 记录初始位置，防止跳动
  document.addEventListener('mousemove', handleResizing)
  document.addEventListener('mouseup', stopResizing)
  // 防止拖拽时选中文字
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

const handleResizing = (e) => {
  if (!isDragging.value) return
  
  const container = document.querySelector('.editor-main')
  if (!container) return
  
  const containerRect = container.getBoundingClientRect()
  const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100
  
  // 限制最小和最大宽度 (10% - 90%)
  if (newWidth >= 10 && newWidth <= 90) {
    editorPaneWidth.value = newWidth
  }
}

const stopResizing = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleResizing)
  document.removeEventListener('mouseup', stopResizing)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

// 导出 PDF
const exportToPDF = () => {
  if (!activeNote.value) return
  
  const element = document.querySelector('.markdown-preview')
  const opt = {
    margin: 10,
    filename: `${activeNote.value.title || '笔记'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }
  
  html2pdf().set(opt).from(element).toPdf().get('pdf').then(function (pdf) {
    // 可以在这里进一步操作 pdf 对象（如果需要）
  }).save()
}

// 导出 JPG
const exportToJPG = async () => {
  if (!activeNote.value) return
  
  const element = document.querySelector('.markdown-preview')
  if (!element) return

  try {
    // 确保 mermaid 已经渲染完成
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: (clonedDoc) => {
        // 在克隆的文档中可以进行一些微调，比如强制显示某些元素
        const clonedElement = clonedDoc.querySelector('.markdown-preview')
        if (clonedElement) {
          clonedElement.style.height = 'auto'
          clonedElement.style.overflow = 'visible'
          
          // 强制代码块换行
          const pres = clonedElement.querySelectorAll('pre')
          pres.forEach(pre => {
            pre.style.whiteSpace = 'pre-wrap'
            pre.style.wordBreak = 'break-all'
          })
        }
      }
    })
    
    canvas.toBlob((blob) => {
      if (blob) {
        saveAs(blob, `${activeNote.value.title || '笔记'}.jpg`)
      }
    }, 'image/jpeg', 0.9)
  } catch (error) {
    console.error('导出 JPG 失败:', error)
    alert('导出 JPG 失败，请检查控制台。')
  }
}

// 导出 Doc (Word)
// 导出为标准 Docx
const exportToDoc = async () => {
  if (!activeNote.value) return
  
  const title = activeNote.value.title || '笔记'
  const content = activeNote.value.content
  const htmlContent = md.render(content)
  
  // 注入样式以确保代码块在 Word 中正常换行
  // 使用更通用的正则匹配 pre 标签，处理可能存在的属性，并确保它不被移除
  // 注意：某些 word 渲染器可能不支持过于复杂的 CSS，这里保持核心换行和背景样式
  const styledHtmlContent = htmlContent.replace(/<pre([^>]*)>/g, (match, p1) => {
    // 如果原标签已有 style 属性，需要合并，否则直接添加
    if (p1.includes('style=')) {
      return match.replace('style="', 'style="white-space: pre-wrap; word-break: break-all; background: #1e293b; color: #f8fafc; padding: 16px; border-radius: 12px; ')
    } else {
      return `<pre${p1} style="white-space: pre-wrap; word-break: break-all; background: #1e293b; color: #f8fafc; padding: 16px; border-radius: 12px;">`
    }
  })
  
  // 构建 HTML 内容（html-to-docx 不需要完整的 html/head 标签，直接提供 body 内容即可）
  // 移除所有包裹的 div，确保第一个元素没有 top margin，以防触发空页
  const fullHtml = `<h1 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 0; font-family: 'Segoe UI', Arial, sans-serif;">${title}</h1>
<div style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6;">${styledHtmlContent}</div>`.trim()

  try {
    let blob = await HTMLtoDOCX(fullHtml, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    })
    
    // 如果返回的是 Buffer (Node.js 默认行为)，则在浏览器中转换为 Blob
    if (blob instanceof Uint8Array || (blob && blob.type === 'Buffer')) {
      blob = new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    }
    
    saveAs(blob, `${title}.docx`)
  } catch (error) {
    console.error('导出 Docx 失败:', error)
    alert('导出 Docx 失败，请检查控制台。')
  }
}
const startSidebarResizing = (e) => {
  isSidebarDragging.value = true
  
  // 记录初始点击位置和侧边栏宽度的偏移，防止跳动
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  
  const handleMove = (moveEvent) => {
    if (!isSidebarDragging.value) return
    const deltaX = moveEvent.clientX - startX
    const newWidth = startWidth + deltaX
    
    // 限制最小和最大宽度 (200px - 600px)
    if (newWidth >= 200 && newWidth <= 600) {
      sidebarWidth.value = newWidth
    }
  }
  
  const handleUp = () => {
    isSidebarDragging.value = false
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
  
  // 防止拖拽时选中文字
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

const openShareModal = async () => {
  try {
    // 优先尝试获取服务器 IP
    let fetchedIp = ''
    try {
      const response = await fetch(`${API_BASE}/system/info`)
      const data = await response.json()
      if (data.addresses && data.addresses.length > 0) {
        // 优先寻找 192.168 开头的 IP
        const localIp = data.addresses.find(ip => ip.startsWith('192.168.'))
        fetchedIp = localIp || data.addresses[0]
      }
    } catch (e) {
      console.warn('无法从后端获取 IP，尝试使用当前浏览器地址栏 IP', e)
    }

    // 如果后端获取失败，降级使用当前地址栏 IP
    if (!fetchedIp) {
      const hostname = window.location.hostname
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        fetchedIp = hostname
      }
    }

    if (fetchedIp) {
      shareIp.value = fetchedIp
      // 在链接中加入 noteId 参数，以便直达特定笔记
      const shareUrl = `http://${shareIp.value}:${sharePort.value}?noteId=${activeId.value}`
      qrCodeImg.value = await QRCode.toDataURL(shareUrl)
      showShareModal.value = true
    } else {
      alert('未找到有效的局域网 IP，请确保服务器已启动并在内网环境运行。')
    }
  } catch (error) {
    console.error('获取分享信息失败:', error)
    alert('无法获取内网共享信息: ' + error.message)
  }
}

const copyShareUrl = () => {
  const shareUrl = `http://${shareIp.value}:${sharePort.value}?noteId=${activeId.value}`
  navigator.clipboard.writeText(shareUrl).then(() => {
    alert('分享链接已复制到剪贴板')
  })
}

</script>

<template>
  <div class="notepad-container">
    <div class="sidebar" :style="{ width: sidebarWidth + 'px' }">
      <div class="sidebar-header">
        <button @click="createNewNote" class="new-btn" :disabled="currentUser && currentUser.isSubUser" :title="currentUser && currentUser.isSubUser ? '子账户无法新建笔记' : ''">
          <span class="plus-icon">+</span> 新建笔记
        </button>
        <div class="search-container">
          <input v-model="searchQuery" placeholder="搜索笔记..." class="search-input" />
        </div>
      </div>
      <draggable 
        v-model="filteredNotes" 
        class="note-list" 
        item-key="id"
        handle=".note-item"
        ghost-class="ghost-item"
      >
        <template #item="{ element: note }">
          <div 
            class="note-item" 
            :class="{ active: activeId === note.id }"
            @click="selectNote(note.id)"
          >
            <div class="note-item-content">
              <div class="note-item-title">{{ note.title || '无标题' }}</div>
              <div class="note-item-date-range" v-if="note.startDate || note.endDate">
                {{ note.startDate || '...' }} ~ {{ note.endDate || '...' }}
              </div>
              <div class="note-item-info">
                <span class="note-item-date">{{ formatDate(note.updatedAt) }}</span>
              </div>
            </div>
            <button class="delete-btn" @click.stop="deleteNote(note.id)" title="删除" v-if="!currentUser || !currentUser.isSubUser || isNoteAuthorized(note.id)">
              <span class="delete-icon">🗑️</span>
            </button>
          </div>
        </template>
      </draggable>
    </div>
    
    <div class="sidebar-resizer" @mousedown="startSidebarResizing" :class="{ dragging: isSidebarDragging }"></div>
    
    <div class="editor-area" v-if="activeNote">
      <div class="editor-header">
        <div class="header-main">
          <div class="title-row">
            <input v-model="activeNote.title" class="title-input" @input="handleInput" placeholder="请输入标题..." :readonly="currentUser && currentUser.isSubUser && !isNoteAuthorized(activeNote.id)" />
            <div class="date-range-picker">
              <span class="calendar-icon">📅</span>
              <input type="date" v-model="activeNote.startDate" @change="handleDateChange" class="date-input" :readonly="currentUser && currentUser.isSubUser && !isNoteAuthorized(activeNote.id)" />
              <span class="date-separator">~</span>
              <input type="date" v-model="activeNote.endDate" @change="handleDateChange" class="date-input" :readonly="currentUser && currentUser.isSubUser && !isNoteAuthorized(activeNote.id)" />
            </div>
          </div>
          <div class="editor-meta">
            <span :class="['save-status', saveStatus, { 'warning': currentUser && currentUser.isSubUser && activeNote && !isNoteAuthorized(activeNote.id) }]">
              {{ saveStatus === 'saving' ? '正在保存到数据库...' : 
                 saveStatus === 'error' ? '❌ 同步失败，已存入本地缓存' : 
                 (currentUser && currentUser.isSubUser && activeNote && !isNoteAuthorized(activeNote.id)) ? '⚠️ 您无权修改此笔记 (内容不会被保存)' :
                 '✅ 已同步到数据库' }}
            </span>
            <span class="save-time">上次修改: {{ formatDate(activeNote.updatedAt) }}</span>
          </div>
        </div>
        <div class="header-actions">
          <button @click="openShareModal" class="export-btn share-btn" title="内网共享">
            <span class="btn-icon">🔗</span> 共享
          </button>
          <button @click="exportToDoc" class="export-btn doc-btn" title="导出为 Word">
            <span class="btn-icon">📄</span> Word
          </button>
          <button @click="exportToPDF" class="export-btn pdf-btn" title="导出为 PDF">
            <span class="btn-icon">📕</span> PDF
          </button>
          <button @click="exportToJPG" class="export-btn jpg-btn" title="导出为 JPG">
            <span class="btn-icon">🖼️</span> JPG
          </button>
        </div>
      </div>
      <div class="editor-main">
        <div class="editor-pane" :style="{ width: editorPaneWidth + '%', flex: 'none' }">
          <div class="pane-label">编辑</div>
          <textarea 
            v-model="activeNote.content" 
            class="markdown-editor" 
            placeholder="在此输入 Markdown 内容..."
            @input="handleInput"
            :readonly="currentUser && currentUser.isSubUser && !isNoteAuthorized(activeNote.id)"
          ></textarea>
        </div>
        <div class="resizer" @mousedown="startResizing" :class="{ dragging: isDragging }"></div>
        <div class="preview-pane" :style="{ width: (100 - editorPaneWidth) + '%', flex: 'none' }">
          <div class="pane-label">预览</div>
          <div class="markdown-preview" v-html="renderedMarkdown"></div>
        </div>
      </div>
    </div>
    
    <div class="empty-state" v-else>
      <p>选择一个笔记开始编写，或点击“新建笔记”按钮。</p>
    </div>

    <!-- 共享弹窗 -->
    <div v-if="showShareModal" class="modal-overlay" @click="showShareModal = false">
      <div class="modal-content share-modal" @click.stop>
        <div class="modal-header">
          <h3>内网共享</h3>
          <button class="close-btn" @click="showShareModal = false">×</button>
        </div>
        <div class="modal-body">
          <p class="share-desc">其他内网用户可以通过以下地址访问并操作：</p>
          <div class="share-link-box">
            <code class="share-url">http://{{ shareIp }}:{{ sharePort }}?noteId={{ activeId }}</code>
            <button class="copy-btn" @click="copyShareUrl">复制</button>
          </div>
          <div class="qr-code-container" v-if="qrCodeImg">
            <img :src="qrCodeImg" alt="分享二维码" />
            <p>手机扫码快速访问</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notepad-container {
  display: flex;
  height: 100vh;
  background: white;
  color: #2c3e50;
  overflow: hidden;
}

.sidebar {
  border-right: none;
  display: flex;
  flex-direction: column;
  background: #fcfcfc;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 20px 16px;
  background: #fcfcfc;
}

.new-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
  opacity: 0.7;
}

.new-btn {
  width: 100%;
  padding: 12px;
  background: var(--primary-color, #42b883);
  color: white;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  margin-bottom: 20px;
  font-weight: 600;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(66, 184, 131, 0.2);
}

.new-btn:hover {
  background: var(--primary-hover, #33a06f);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(66, 184, 131, 0.3);
}

.plus-icon {
  font-size: 20px;
  font-weight: 400;
}

.search-container {
  position: relative;
}

.search-input {
  width: 100%;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #eee;
  background: white;
  color: #2c3e50;
  font-size: 0.9rem;
  transition: all 0.3s;
}

.search-input:focus {
  outline: none;
  border-color: #42b883;
  box-shadow: 0 0 0 3px rgba(66, 184, 131, 0.1);
}

.note-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 20px;
}

.note-item {
  padding: 16px;
  margin-bottom: 8px;
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
  display: flex;
  align-items: center;
  border: 1px solid transparent;
}

.note-item:hover {
  background: white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  transform: translateX(4px);
}

.note-item.active {
  background: white;
  border-color: #42b883;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.note-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 15%;
  height: 70%;
  width: 4px;
  background: #42b883;
  border-radius: 0 4px 4px 0;
}

.note-item-content {
  flex: 1;
  min-width: 0;
}

.note-item-title {
  font-weight: 600;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #2c3e50;
  margin-bottom: 2px;
}

.note-item-date-range {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 4px;
}

.note-item-info {
  display: flex;
  align-items: center;
}

.note-item-date {
  font-size: 0.75rem;
  color: #94a3b8;
}

.delete-btn {
  padding: 8px;
  background: transparent;
  border: none;
  opacity: 0;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 8px;
  margin-left: 8px;
}

.note-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #fff1f2;
}

.delete-icon {
  font-size: 1.1rem;
}

.ghost-item {
  opacity: 0.5;
  background: #f0fdf4 !important;
  border: 2px dashed #42b883 !important;
}

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
}

.editor-header {
  padding: 16px 24px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.header-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0; /* 允许标题缩放 */
}

.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 4px;
}

.title-input {
  flex: 1;
  min-width: 200px;
  font-size: 1.5rem;
  font-weight: 700;
  border: none;
  outline: none;
  background: transparent;
  color: #1e293b;
  margin-bottom: 0;
}

.date-range-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #f1f5f9;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.calendar-icon {
  font-size: 1rem;
}

.date-input {
  border: none;
  background: transparent;
  color: #475569;
  font-size: 0.85rem;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}

.date-input::-webkit-calendar-picker-indicator {
  cursor: pointer;
  opacity: 0.6;
}

.date-input::-webkit-calendar-picker-indicator:hover {
  opacity: 1;
}

.date-separator {
  color: #94a3b8;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.export-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: white;
  color: #64748b;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.export-btn:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #1e293b;
}

.doc-btn:hover {
  border-color: #3b82f6;
  color: #3b82f6;
  background: #eff6ff;
}

.pdf-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: #fef2f2;
}

.jpg-btn:hover {
  border-color: #f59e0b;
  color: #f59e0b;
  background: #fffbeb;
}

.share-btn {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}

.share-btn:hover {
  background: #dcfce7;
  border-color: #86efac;
}

/* 弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: white;
  border-radius: 16px;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.modal-header {
  padding: 16px 24px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #1e293b;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #94a3b8;
  cursor: pointer;
}

.modal-body {
  padding: 24px;
  text-align: center;
}

.share-desc {
  color: #64748b;
  margin-bottom: 16px;
  font-size: 0.95rem;
}

.share-link-box {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  background: #f8fafc;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.share-url {
  flex: 1;
  text-align: left;
  font-family: monospace;
  word-break: break-all;
  color: #2563eb;
  align-self: center;
}

.copy-btn {
  padding: 6px 12px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
}

.qr-code-container img {
  width: 200px;
  height: 200px;
  margin-bottom: 8px;
}

.qr-code-container p {
  color: #94a3b8;
  font-size: 0.85rem;
}

.btn-icon {
  font-size: 1.1rem;
}


.editor-meta {
  font-size: 0.8rem;
  color: #94a3b8;
  display: flex;
  gap: 12px;
  align-items: center;
}

.save-status {
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  transition: all 0.3s;
}

.save-status.saving {
  color: #3b82f6;
  background: #eff6ff;
}

.save-status.error {
  color: #ef4444;
  background: #fef2f2;
}

.save-status.warning {
  color: #f59e0b;
  background: #fffbeb;
  font-weight: bold;
}

.save-status.saved {
  color: #10b981;
}

.save-time {
  color: #94a3b8;
}

.editor-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  padding: 0;
}

.editor-pane, .preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
}

.editor-pane {
  border-right: none;
}

.resizer, .sidebar-resizer {
  width: 6px;
  background: transparent;
  cursor: col-resize;
  transition: all 0.2s;
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: center;
}

.resizer::before, .sidebar-resizer::before {
  content: '';
  width: 1px;
  height: 100%;
  background: #3b82f6; /* 蓝色 */
  transition: all 0.2s;
}

.resizer:hover::before, .resizer.dragging::before,
.sidebar-resizer:hover::before, .sidebar-resizer.dragging::before {
  width: 3px;
  background: #2563eb; /* 深蓝色反馈 */
}

.resizer::after, .sidebar-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}

.pane-label {
  padding: 8px 32px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #94a3b8;
  letter-spacing: 0.05em;
  background: #f8fafc;
}

.markdown-editor {
  flex: 1;
  padding: 24px 32px;
  border: none;
  resize: none;
  outline: none;
  font-family: 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 1.05rem;
  background: transparent;
  color: #334155;
  line-height: 1.7;
}

.markdown-preview {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
  color: #334155;
  line-height: 1.7;
  font-size: 1.05rem;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #94a3b8;
  background: #f8fafc;
}

.empty-state p {
  font-size: 1.1rem;
  margin-top: 16px;
}

/* Markdown 样式增强 */
.markdown-preview :deep(h1) { font-size: 2rem; border-bottom: 2px solid #f1f5f9; padding-bottom: 0.3em; margin-bottom: 1rem; font-weight: 700; }
.markdown-preview :deep(h2) { font-size: 1.5rem; margin-top: 1.5rem; font-weight: 700; }
.markdown-preview :deep(h3) { font-size: 1.25rem; font-weight: 600; }
.markdown-preview :deep(p) { margin: 1em 0; }
.markdown-preview :deep(strong), .markdown-preview :deep(b) { font-weight: bold; }
.markdown-preview :deep(blockquote) {
  margin: 1em 0;
  padding-left: 1em;
  border-left: 4px solid #42b883;
  color: #64748b;
  font-style: italic;
}

.markdown-preview :deep(pre) {
  background: #1e293b;
  color: #f8fafc;
  padding: 16px;
  border-radius: 12px;
  overflow-x: auto;
  margin: 1.5em 0;
  /* 添加换行支持 */
  white-space: pre-wrap;
  word-break: break-all;
}

.markdown-preview :deep(code) {
  background: #f1f5f9;
  color: #e11d48;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.markdown-preview :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}

.markdown-preview :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.markdown-preview :deep(.mermaid) {
  display: flex;
  justify-content: center;
  margin: 1.5em 0;
  background: #f8fafc;
  padding: 1.5rem;
  border-radius: 8px;
  overflow-x: auto; /* 允许横向滚动，防止大图溢出 */
  min-height: 50px;
}

.markdown-preview :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
}

.markdown-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
}

.markdown-preview :deep(th), .markdown-preview :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 12px;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: #f8fafc;
}

/* KaTeX CSS */
@import 'katex/dist/katex.min.css';

/* 修复 KaTeX 渲染问题：显示 HTML 版本，隐藏 MathML 版本 */
.markdown-preview :deep(.katex-mathml) {
  display: none;
}

.markdown-preview :deep(.katex-html) {
  display: inline-block;
}
</style>
