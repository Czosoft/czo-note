<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import MarkdownItKatex from 'markdown-it-katex'
import draggable from 'vuedraggable'
import html2pdf from 'html2pdf.js'

const md = new MarkdownIt().use(MarkdownItKatex)

// 状态定义
const notes = ref([])
const activeId = ref(null)
const searchQuery = ref('')

// API 地址：如果是开发模式则使用 localhost，如果是生产环境（Docker 部署）建议改为服务器 IP 或使用相对路径
const API_BASE = import.meta.env.DEV 
  ? 'http://localhost:3000/api' 
  : `http://${window.location.hostname}:3000/api`

// 从数据库加载笔记
const fetchNotes = async () => {
  try {
    const response = await fetch(`${API_BASE}/notes`)
    if (response.ok) {
      const data = await response.json()
      notes.value = data
      
      // 默认选中第一个
      if (notes.value.length > 0 && !activeId.value) {
        activeId.value = notes.value[0].id
      }
    }
  } catch (error) {
    console.error('Failed to fetch notes:', error)
    // 降级使用 localStorage
    const savedNotes = localStorage.getItem('notes')
    if (savedNotes) {
      notes.value = JSON.parse(savedNotes)
    }
  }
}

onMounted(() => {
  fetchNotes()
})

// 保存防抖控制
let saveTimeout = null
const syncNotesToDb = () => {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(async () => {
    try {
      await fetch(`${API_BASE}/notes/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.value })
      })
      // 同时备份到 localStorage
      localStorage.setItem('notes', JSON.stringify(notes.value))
    } catch (error) {
      console.error('Failed to sync notes:', error)
      localStorage.setItem('notes', JSON.stringify(notes.value))
    }
  }, 500) // 500ms 防抖
}

// 监听 notes 变化并保存
watch(notes, () => {
  syncNotesToDb()
}, { deep: true })

// 当前选中的笔记
const activeNote = computed(() => {
  return notes.value.find(note => note.id === activeId.value) || null
})

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
const renderedMarkdown = computed(() => {
  if (!activeNote.value) return ''
  return md.render(activeNote.value.content)
})

// 功能函数
const createNewNote = () => {
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

const deleteNote = (id) => {
  if (confirm('确定删除这条笔记吗？')) {
    const index = notes.value.findIndex(note => note.id === id)
    if (index !== -1) {
      notes.value.splice(index, 1)
      if (activeId.value === id) {
        activeId.value = notes.value.length > 0 ? notes.value[0].id : null
      }
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
    if (activeNote.value.title === '未命名笔记' && activeNote.value.content.trim()) {
      activeNote.value.title = activeNote.value.content.trim().split('\n')[0].substring(0, 20)
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
  
  html2pdf().set(opt).from(element).save()
}

// 导出 Doc (Word)
const exportToDoc = () => {
  if (!activeNote.value) return
  
  const title = activeNote.value.title || '笔记'
  const content = activeNote.value.content
  const htmlContent = md.render(content)
  
  // 使用简单的 HTML 格式导出 Word，这种方式兼容性较好
  const header = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>${title}</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      h1, h2, h3, h4, h5, h6 { color: #2c3e50; }
      pre { background: #f6f8fa; padding: 10px; border-radius: 5px; }
      code { font-family: 'Fira Code', monospace; }
      table { border-collapse: collapse; width: 100%; }
      table, th, td { border: 1px solid #dfe2e5; padding: 8px; }
      blockquote { border-left: 4px solid #dfe2e5; color: #6a737d; padding-left: 16px; margin-left: 0; }
    </style>
    </head><body>
  `
  const footer = "</body></html>"
  const sourceHTML = header + htmlContent + footer
  
  const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML)
  const fileDownload = document.createElement("a")
  document.body.appendChild(fileDownload)
  fileDownload.href = source
  fileDownload.download = `${title}.doc`
  fileDownload.click()
  document.body.removeChild(fileDownload)
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

</script>

<template>
  <div class="notepad-container">
    <div class="sidebar" :style="{ width: sidebarWidth + 'px' }">
      <div class="sidebar-header">
        <button @click="createNewNote" class="new-btn">
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
            <button class="delete-btn" @click.stop="deleteNote(note.id)" title="删除">
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
            <input v-model="activeNote.title" class="title-input" @input="handleInput" placeholder="请输入标题..." />
            <div class="date-range-picker">
              <span class="calendar-icon">📅</span>
              <input type="date" v-model="activeNote.startDate" @change="handleInput" class="date-input" />
              <span class="date-separator">~</span>
              <input type="date" v-model="activeNote.endDate" @change="handleInput" class="date-input" />
            </div>
          </div>
          <div class="editor-meta">
            上次保存: {{ formatDate(activeNote.updatedAt) }}
          </div>
        </div>
        <div class="header-actions">
          <button @click="exportToDoc" class="export-btn doc-btn" title="导出为 Word">
            <span class="btn-icon">📄</span> Word
          </button>
          <button @click="exportToPDF" class="export-btn pdf-btn" title="导出为 PDF">
            <span class="btn-icon">📕</span> PDF
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

.btn-icon {
  font-size: 1.1rem;
}


.editor-meta {
  font-size: 0.8rem;
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
.markdown-preview :deep(h1) { font-size: 2rem; border-bottom: 2px solid #f1f5f9; padding-bottom: 0.3em; margin-bottom: 1rem; }
.markdown-preview :deep(h2) { font-size: 1.5rem; margin-top: 1.5rem; }
.markdown-preview :deep(h3) { font-size: 1.25rem; }
.markdown-preview :deep(p) { margin: 1em 0; }
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

/* 修复 KaTeX 渲染问题：使用备用内容（MathML），隐藏默认渲染（HTML） */
.markdown-preview :deep(.katex-mathml) {
  display: inline-block;
}

.markdown-preview :deep(.katex-html) {
  display: none;
}
</style>
