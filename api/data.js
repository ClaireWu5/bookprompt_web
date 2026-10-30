// =========================================================
// /api/data — Vercel Serverless Function
// 作用：用飞书开放平台 API 读取多维表格数据，组装成与
// data.json 完全相同的结构返回给前端。
// 飞书侧的任何修改，网页刷新即可看到（缓存 60 秒）。
//
// 需要在 Vercel 上配置环境变量（见 README）：
//   FEISHU_APP_ID            自建应用 App ID
//   FEISHU_APP_SECRET        自建应用 App Secret
//   FEISHU_APP_TOKEN         多维表格 app_token（URL 中 /base/ 后面那段）
//   FEISHU_TABLE_CATEGORIES  categories 表的 table_id
//   FEISHU_TABLE_BOOKS       books 表的 table_id
//   FEISHU_TABLE_PROMPTS     prompts 表的 table_id
// =========================================================

// 中国版飞书用默认域名；国际版 Lark 需在环境变量设 FEISHU_HOST=https://open.larksuite.com
const HOST = process.env.FEISHU_HOST || "https://open.feishu.cn";

const CFG = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appToken: process.env.FEISHU_APP_TOKEN,
  tableCategories: process.env.FEISHU_TABLE_CATEGORIES,
  tableBooks: process.env.FEISHU_TABLE_BOOKS,
  tablePrompts: process.env.FEISHU_TABLE_PROMPTS,
};

// ---------- 飞书 API 基础 ----------

let tokenCache = { token: null, expire: 0 };

async function getTenantAccessToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expire - 60_000) return tokenCache.token;

  const res = await fetch(`${HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: CFG.appId, app_secret: CFG.appSecret }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`获取 tenant_access_token 失败: ${json.msg}`);

  tokenCache = { token: json.tenant_access_token, expire: now + json.expire * 1000 };
  return json.tenant_access_token;
}

async function listRecords(token, appToken, tableId) {
  const fieldsList = [];
  let pageToken = "";
  do {
    const url = new URL(
      `${HOST}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`
    );
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (json.code !== 0) throw new Error(`读取数据表 ${tableId} 失败: ${json.msg}`);

    fieldsList.push(...(json.data.items || []).map((it) => it.fields));
    pageToken = json.data.has_more ? json.data.page_token : "";
  } while (pageToken);
  return fieldsList;
}

// 知识库里的多维表格：/wiki/ 链接中的 token 并非 app_token，
// 这里先尝试通过知识库 API 换算出真实 app_token（需要 wiki:wiki:readonly 权限），
// 换算失败则按原始 token 使用（兼容直接填 Basc... 的情况）。
let resolvedAppToken = null;

async function getAppToken(token) {
  if (resolvedAppToken) return resolvedAppToken;
  let appToken = CFG.appToken;
  try {
    const res = await fetch(
      `${HOST}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(CFG.appToken)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await res.json();
    const node = json?.data?.node;
    if (json.code === 0 && node && node.obj_type === "bitable" && node.obj_token) {
      appToken = node.obj_token;
    }
  } catch { /* 忽略：直接使用原始 token */ }
  resolvedAppToken = appToken;
  return appToken;
}

// ---------- 字段值规整 ----------

// 文本字段 → 字符串（兼容多行文本/富文本等返回形态）
function S(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x?.text || "")).join("").trim();
  return String(v).trim();
}

// 多选字段 → 数组（也兼容 "a,b" / "a，b" 的纯文本写法）
function A(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x.trim() : S(x))).filter(Boolean);
  return String(v)
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFAULT_GRAD = "linear-gradient(120deg,#5B4A6E 0%,#9A5B6E 55%,#E0A458 100%)";

// ---------- 主入口 ----------

export default async function handler(req, res) {
  try {
    const missing = Object.entries(CFG)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) throw new Error(`缺少环境变量: ${missing.join(", ")}`);

    const token = await getTenantAccessToken();
    const appToken = await getAppToken(token);
    const [catRows, bookRows, promptRows] = await Promise.all([
      listRecords(token, appToken, CFG.tableCategories),
      listRecords(token, appToken, CFG.tableBooks),
      listRecords(token, appToken, CFG.tablePrompts),
    ]);

    const categories = catRows
      .filter((f) => S(f.id))
      .map((f) => ({ id: S(f.id), zh: S(f.zh), en: S(f.en) }));

    const prompts = promptRows
      .filter((f) => S(f.id))
      .map((f) => ({
        id: S(f.id),
        book_id: S(f.book_id),
        chapter: { zh: S(f.chapter_zh), en: S(f.chapter_en) },
        title: { zh: S(f.title_zh), en: S(f.title_en) },
        desc: { zh: S(f.desc_zh), en: S(f.desc_en) },
        tags: A(f.tags),
        body: S(f.body),
      }));

    const books = bookRows
      .filter((f) => S(f.id))
      .map((f) => {
        const id = S(f.id);
        return {
          id,
          grad: S(f.grad) || DEFAULT_GRAD,
          title: { zh: S(f.title_zh), en: S(f.title_en) },
          author: { zh: S(f.author_zh), en: S(f.author_en) },
          desc: { zh: S(f.desc_zh), en: S(f.desc_en) },
          categories: A(f.categories),
          summary: { zh: S(f.summary_zh), en: S(f.summary_en) },
          prompts: prompts.filter((p) => p.book_id === id),
        };
      });

    // 缓存 1 分钟：飞书里改完内容，网页最多 1 分钟后刷新可见
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ categories, books });
  } catch (e) {
    const msg = String(e.message);
    const hints = [];
    if (/not exist|not found|1254040|1254030|base token/i.test(msg)) {
      hints.push("app_token 疑似不对：若填的是知识库 /wiki/ 链接里的 token，请在「权限管理」开通「查看知识库」(wiki:wiki:readonly) 并重新发布应用版本，让服务端能自动换算");
    }
    if (/permission|forbidden|无权限|91403|access denied/i.test(msg)) {
      hints.push("权限不足：请确认 ① 多维表格已「添加文档应用」并给「可阅读」权限 ② bitable:app:readonly 与 wiki:wiki:readonly 已开通且已发布版本");
    }
    if (/21001|platform policy/i.test(msg)) {
      hints.push("飞书平台策略拦截：若是国际版 Lark，请设置环境变量 FEISHU_HOST=https://open.larksuite.com 后 Redeploy");
    }
    res.status(500).json({ error: msg, hints });
  }
}
