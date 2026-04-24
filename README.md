# 天天要练鼓

移动优先的 React + Vite PWA，给鼓手做基础 timing 训练。当前 MVP 已支持：

- BPM `30-240`
- `2/4` `3/4` `4/4`
- `quarter` `eighth` `triplet` `sixteenth`
- 第一拍重音 + 1 个附加重音
- 经典 click、厚击 click、明亮 beep、中文人声数拍、英文人声数拍
- `40%-180%` 超大音量滑杆，100% 以上带压缩保护
- `4 on / 1 off`、`2 on / 2 off`
- 渐进提速
- 本地配置恢复与最近 20 次练习记录

## 本地启动

```bash
npm install
npm run dev
```

PowerShell 如果拦截 `npm`，直接改用 `npm.cmd`。

## 构建

```bash
npm run build
npm run preview
```

## 部署

- GitHub：本地仓库已经初始化为 `main` 分支，接下来只需要加远端并推送。
- Vercel：导入这个仓库即可，`main` 做正式环境，其他分支会自动生成预览链接。
- PWA：生产环境和 `localhost` 会注册 `sw.js`；首次联网打开后，支持基础离线进入。

## iPhone 安装

1. 用 Safari 打开部署后的站点。
2. 点分享。
3. 选择“添加到主屏幕”。
4. 首次进入先点一次“开始练习”，浏览器不会自动播音。
