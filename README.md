# BookPrompt · 工具书 Prompt 索引

把经典工具书的方法论提炼成可直接复制使用的 Prompt。

## 架构：飞书多维表格 = 后端数据库

```
飞书多维表格（唯一数据源，在飞书里改内容）
        ↓  飞书开放平台 API（只读）
Vercel Serverless Function  /api/data   （密钥只放在服务端，安全）
        ↓
prototype/index.html  （前端刷新即看到最新内容）
```

- 你只在飞书表格里维护文字，改完约 1 分钟内（接口缓存 60 秒）网页刷新可见。
- `data.json` 仅作本地开发兜底，线上不再需要手动更新。

## 项目结构

```
prototype/
├── index.html      # 页面（优先请求 /api/data，失败回退 data.json）
├── data.json       # 本地兜底数据
└── api/data.js     # Vercel 云函数：拉取飞书多维表格数据
feishu-import/
├── generate_csv.py # 从 data.json 重新生成 CSV（仅初次迁移用）
├── categories.csv  # 5 条分类
├── books.csv       # 7 本书
└── prompts.csv     # 12 条 Prompt
```

---

# 从零到一：接入飞书（保姆级步骤）

## 第 1 步：建多维表格并导入数据

1. 打开飞书 → 云文档 → 多维表格 → 点「**+ 新建多维表格**」创建**空白**表格（模板选择页里没有导入入口，先建空白表进入编辑页），命名如 `BookPrompt 数据库`。
2. 进入空白表格后，在**底部数据表标签栏点「+」→「导入 Excel/CSV」**（部分版本入口在右上角「…」→「更多」→「导入」），分 3 次分别导入 `feishu-import/` 下的文件（每个文件生成一张独立数据表）：
   - `categories.xlsx` → 数据表命名 **categories**
   - `books.xlsx` → 数据表命名 **books**
   - `prompts.xlsx` → 数据表命名 **prompts**
   （若找不到「导入」，用同目录下的 `.csv` 文件再试；导入时保留首行为标题行。可以把 categories、tags 列转成「多选」字段更好维护，纯文本也兼容。）
3. 删掉多维表格自带的空白数据表。

> 以后所有内容增删改（加新书、改 Prompt 文案、加标签）都直接在飞书里编辑即可。

## 第 2 步：创建飞书自建应用（拿 API 密钥）

1. 浏览器打开 [飞书开放平台](https://open.feishu.cn/)，用飞书账号扫码登录。
2. 首页「创建企业自建应用」，填应用名（如 `BookPrompt 读取器`）和一句话描述 → 创建。
3. 左侧菜单「**凭证与基础信息**」→ 复制 **App ID**（形如 `cli_a5xxxxxxx`）和 **App Secret**（点「查看/复制」）。这两个值之后填进 Vercel 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`。
4. 左侧「**权限管理**」→ 搜索「多维表格」→ 开通权限：
   - 优先勾选「**查看多维表格**」（`bitable:app:readonly`，只读最安全）；
   - 搜不到精确只读项的话，开通「查看、评论、编辑和管理多维表格」（`bitable:app`）也可以，代码只做读取。
5. 左侧「**版本管理与发布**」→「创建版本」→ 版本号填 `1.0.0`、说明随便写 → 提交发布。
   - 个人账号/自己是管理员 → 立即生效；公司账号需管理员在后台审批通过。
   - **不开权限或不发布版本，API 调用会全部失败。** 发布后等 1~2 分钟再测。

## 第 3 步：把应用加为表格协作者（只需授权 1 次）

> **重要概念**：一个「多维表格」= 一个云文档；底部每个标签 = 一张「数据表」。授权加在**文档**上，一次授权，里面所有数据表全部生效——所以只需设置 1 次，不是三张表各设一次。
>
> **自查**：必须是「1 个多维表格，底部 3 个标签（categories / books / prompts）」。如果你建成了 3 个独立的多维表格文档：打开其中一个 → 底部「+」继续导入另外两个文件 → 删掉多余文档，合并成 1 个（因为云函数按 1 个 app_token + 3 个 table_id 设计）。

1. 打开这个多维表格。
2. 右上角「**…**」→「**更多**」→「**添加文档应用**」→ 搜索 `BookPrompt 读取器` → 添加，权限给「**可阅读**」。
   （不加这一步，应用无权访问你的表格，接口会报无权限。）

## 第 4 步：记下表格的三个 ID

打开多维表格，看浏览器地址栏：

```
https://xxx.feishu.cn/base/BascXXXXXXXXX?table=tblYYYYYYYY&view=vewZZZZZ
                              └── app_token ──┘      └ table_id ┘
```

分别点进 categories / books / prompts 三张表，记下 3 个 `table=tbl...`（table_id）和共同的 `app_token`。

> ⚠️ **地址是 `/wiki/` 开头怎么办**：说明表格挂在知识库里，`/wiki/` 后那段不是多维表格 app_token。**云函数已支持自动换算**：直接把 `/wiki/` 后那段填进 `FEISHU_APP_TOKEN` 即可，但需要先在应用「权限管理」开通「**查看知识库**」（`wiki:wiki:readonly`）并重新发布版本，否则换算不生效。三个 table_id 不受影响，照常从 `table=tbl...` 抄。

### 终端 30 秒自检（第 4 步后趁热做，避免部署后排查）

```bash
# ① 验证应用密钥（替换成你的真实值），返回 tenant_access_token 即成功
curl -s -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
  -H "Content-Type: application/json" \
  -d '{"app_id":"cli_xxx","app_secret":"xxx"}'

# ② 验证应用能否读表（用①返回的 token + 第 4 步的 app_token / table_id）
curl -s "https://open.feishu.cn/open-apis/bitable/v1/apps/你的appToken/tables/你的tableId/records?page_size=5" \
  -H "Authorization: Bearer t-xxx"
```

- ① 返回 `app_id or app_secret invalid` → 密钥抄错了
- ② 返回 `code:0` 且有数据 → 全链路就绪；提示无权限/Forbidden → 第 3 步「添加文档应用」没做或未生效

## 第 5 步：部署到 Vercel（一次性）

1. 把本项目推到 GitHub，在 [Vercel](https://vercel.com/) 导入仓库。
   **注意：Root Directory 设置为 `prototype`**（Vercel 会自动把 `api/data.js` 部署为 `/api/data` 云函数）。
2. Vercel 项目 → Settings → Environment Variables，添加 6 个变量：

| 变量名 | 填什么 |
|---|---|
| `FEISHU_APP_ID` | 第 2 步的 App ID |
| `FEISHU_APP_SECRET` | 第 2 步的 App Secret |
| `FEISHU_APP_TOKEN` | 第 4 步的 app_token |
| `FEISHU_TABLE_CATEGORIES` | categories 表的 table_id |
| `FEISHU_TABLE_BOOKS` | books 表的 table_id |
| `FEISHU_TABLE_PROMPTS` | prompts 表的 table_id |
| `FEISHU_HOST` | 可选。国际版 Lark 填 `https://open.larksuite.com`，中国版飞书不用填 |

3. Deploy。打开 `https://你的域名/api/data` 自检：返回 JSON 即成功；返回 `{"error":...}` 按提示排查（最常见：环境变量没填全、第 3 步没加文档应用、权限没发布）。
4. 打开 `https://你的域名` —— 内容已来自飞书。

**以后改内容：只在飞书表格里编辑 → 刷新网页（最多等 1 分钟缓存过期）→ 完成。**

## 本地开发

```bash
cd prototype
python3 -m http.server 8080
# http://localhost:8080  → 本地没有云函数，自动回退 data.json

# 想本地直连飞书调试接口：
npm i -g vercel && vercel dev  # 需先 vercel login / vercel link，并把环境变量写入本地
```

## 字段对照（飞书列名 ↔ 网页含义）

- **books**：`id` 唯一英文标识 / `grad` 渐变色 CSS / `title_zh·title_en` 中英书名 / `author_*` 作者 / `desc_*` 一句话简介 / `categories` 分类 id（逗号分隔）/ `summary_*` 书籍摘要
- **prompts**：`book_id` 属于哪本书（对应 books.id）/ `chapter_*` 章节名 / `title_*·desc_*` Prompt 标题与简介 / `tags` 标签（逗号分隔）/ `body` Prompt 正文（支持多行）
- **categories**：`id` 唯一英文标识 / `zh` 中文分类名 / `en` 英文短码

> 新增一本书：books 表加一行（id 别重复），prompts 表加若干行并把 book_id 填成这本书的 id。删除行即下架。
