# 使用轻量级 Node 镜像作为基础
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制依赖文件并安装（分层构建，提高效率）
COPY package*.json ./
RUN npm install --production

# 复制所有源代码
COPY . .

# 暴露后端端口
EXPOSE 3000

# 启动命令
CMD ["node", "index.js"]
