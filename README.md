# czo-note

一个基于 Vue 3 和 Node.js 构建的现代 Markdown 记事本应用，支持数学公式、实时预览、拖拽排序及多种格式导出。

## ✨ 主要特性

- **Markdown 全力支持**：支持标准的 Markdown 语法。
- **KaTeX 数学公式**：集成 KaTeX，支持复杂的数学公式渲染。
- **实时预览**：双栏布局，左侧编辑，右侧实时预览，支持宽度拖拽调节。
- **拖拽排序**：笔记列表支持通过拖拽自由调整顺序。
- **多格式导出**：
  - 导出为 **PDF**。
  - 导出为 **Word (.doc)**。
- **任务管理**：支持为笔记设置开始和结束日期。
- **响应式设计**：适配不同屏幕尺寸的侧边栏。
- **持久化存储**：后端使用 MySQL 存储，并支持自动同步和本地缓存备份。

## 🛠️ 技术栈

### 前端
- **框架**：Vue 3 (Composition API)
- **构建工具**：Vite
- **依赖库**：
  - `markdown-it`: Markdown 解析
  - `markdown-it-katex`: 数学公式扩展
  - `vuedraggable`: 拖拽组件
  - `html2pdf.js`: PDF 导出

### 后端
- **运行环境**：Node.js
- **数据库**：MySQL 8.0
- **容器化**：Docker & Docker Compose

## 🚀 快速开始

### 1. 克隆项目
```bash
git clone <repository-url>
cd czo-note
```

### 2. 环境配置
确保你已安装 Node.js (v20+) 和 MySQL 8.0。

#### 数据库连接配置
- **手动运行**：
  修改 `server/index.js` 中的 `dbConfig` 配置对象（约第 13-19 行）：
  - `host`: 数据库地址（默认 `localhost`）
  - `user`: 数据库用户（默认 `root`）
  - `password`: 数据库密码（默认 `123456`）
  - `database`: 数据库名称（默认 `czo_note`）
- **Docker 运行**：
  修改根目录下的 `docker-compose.yml` 文件中的 `environment` 部分。

### 3. 安装依赖
```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server
npm install
cd ..
```

### 4. 运行
```bash
# 启动后端服务
npm run server

# 启动前端开发服务器
npm run dev
```

### 5. 访问
- 前端访问地址：`http://localhost:5173`
- 默认访问密码：`1234`

## 🐳 Docker 部署

项目支持使用 Docker Compose 一键部署：

```bash
docker-compose up -d
```

这将自动启动以下容器：
- `czo-note-db`: MySQL 8.0 数据库
- `czo-note-server`: Node.js 后端 API
- `czo-note-web`: Vue 前端应用（通过 Nginx 托管）

## 📄 开源协议

本项目基于 **GNU GPL v3** 协议开源。详情请参阅 [LICENSE](LICENSE) 文件。

Copyright (c) 2026.
