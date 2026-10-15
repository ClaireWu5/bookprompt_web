# BookPrompt · 工具书 Prompt 索引

把经典工具书的方法论提炼成可直接复制使用的 Prompt。

## 项目结构

```
prototype/
├── index.html   # 页面框架（样式 + 渲染逻辑）
└── data.json    # 全部书籍与 Prompt 数据
```

## 本地开发

```bash
cd prototype
python3 -m http.server 8080
# 打开 http://localhost:8080
```

> 注意：数据通过 fetch 加载，必须走本地服务器访问，直接双击 index.html 无法加载 data.json。

## 内容维护（更新数据）

1. 在飞书多维表格中维护 `books` / `prompts` 数据（字段与 `data.json` 对齐）
2. 导出/生成新的 `data.json` 替换本文件
3. 提交并推送，Vercel 自动重新部署

## 部署

接入 Vercel 后，push 到 main 分支即自动部署，无需手动操作。
