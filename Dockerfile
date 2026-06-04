# 构建阶段：构建前端生产代码
FROM node:18-alpine as build-stage
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 运行阶段：使用 Nginx 托管静态文件
FROM nginx:stable-alpine as production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 这里的 nginx 默认监听 80 端口
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
