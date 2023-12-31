## nvless

一个用typescript实现的只使用ws链接的vless协议服务端。

### 为什么重复造轮子

+ 研究nodejs在这方面的极限
+ 研究nodejs中的内存和cpu的控制
+ 在已有vps的基础上，如何简化配置

### 特性

+ 支持 tcp 协议
+ 支持 udp 协议（需要完整测试）
+ 支持 mux tcp 协议
+ 支持 mux udp 协议（需要完整测试）
+ 内存：占用小
+ cpu：占用低
+ 支持 docker
+ 支持：配置文件/环境变量

## 如何开始

## docker compose 部署

+ 下载文件 [docker-compose.yml](./docker-compose.yml)
+ 修改配置文件：
  + 端口：默认3000
  + uuid：默认 13170fcc-1966-507d-bce9-532cc588fcf3
  + 路径：默认 /nvless
+ 启动：`docker-compose up -d`
+ 注意：开启防火墙端口
+ 注意：要支持https，请部署在nginx之后，推荐使用 [1Panel](https://github.com/1Panel-dev/1Panel) 部署
+ nginx 配置参考：

```nginx
location = /nvless {
    proxy_pass http://127.0.0.1:3000; 
    proxy_set_header Host $host; 
    proxy_set_header X-Real-IP $remote_addr; 
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; 
    proxy_set_header REMOTE-HOST $remote_addr; 
    proxy_set_header Upgrade $http_upgrade; 
    proxy_set_header Connection "upgrade"; 
    proxy_set_header X-Forwarded-Proto $scheme; 
    proxy_http_version 1.1; 
    add_header Cache-Control no-cache; 
}
```

### 本地调试

+ 拷贝 [.env.example](./.env.example) 一份为本地配置 `.env.local`
+ 修改配置文件
+ 启动

```bash
# 安装依赖
npm install

# 启动服务
npm run test
```
