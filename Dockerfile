# 基于Node.js 20版本的Slim镜像构建
FROM node:20-slim AS build-env

# 安装 jemalloc
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libjemalloc2 && \
    rm -rf /var/lib/apt/lists/*


COPY . /app
# 设置工作目录
WORKDIR /app

# 安装项目依赖
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs20-debian12

COPY --from=build-env /usr/lib/x86_64-linux-gnu/libjemalloc.so.2 /usr/lib/x86_64-linux-gnu/

# 设置环境变量使 jemalloc 全局起效
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2

COPY --from=build-env /app /app

WORKDIR /app

# 暴露应用程序使用的端口（根据你的应用程序进行修改）
EXPOSE 3000

# 运行应用程序,这里不加载env文件了，交给用户自己搞定
CMD ["--import", "tsx", "src/index.ts"]
