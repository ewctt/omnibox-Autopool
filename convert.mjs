import fs from "fs";
import crypto from "crypto";

const urls = JSON.parse(fs.readFileSync("pool.json", "utf-8"));

function uuid() {
  return crypto.randomUUID();
}

function isHttp(str) {
  return typeof str === "string" && str.startsWith("http");
}

async function testSpeed(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const start = Date.now();
  try {
    await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return Date.now() - start;
  } catch {
    return null;
  }
}

let rawItems = [];
let stats = {
  totalSources: 0,
  extractedApis: 0,
  validApis: 0,
  invalidApis: 0
};

// ===== 读取源 =====
for (const url of urls) {
  try {
    const res = await fetch(url);
    const text = await res.text(); // 先拿纯文本，防止 json() 直接崩溃

    let data;
    try {
      // 1. 尝试直接作为普通 JSON 解析
      data = JSON.parse(text);
    } catch {
      // 2. 如果失败，尝试作为 Base64 解密后再解析
      try {
        console.log("检测到加密或特殊格式，尝试 Base64 解密:", url);
        // 去掉可能存在的 TVBox 伪装头（如 ** 或者 #）
        const cleanedText = text.replace(/^[#\*]+/, "").trim(); 
        const decodedText = Buffer.from(cleanedText, "base64").toString("utf-8");
        data = JSON.parse(decodedText);
      } catch (decodeErr) {
        throw new Error("标准 JSON 和 Base64 解密均失败");
      }
    }

    stats.totalSources++;

    if (Array.isArray(data)) {
      rawItems.push(...data);
    } else if (data.sites && Array.isArray(data.sites)) {
      rawItems.push(...data.sites);
    }

    console.log("读取成功:", url);
  } catch (err) {
    console.log("读取失败:", url, "原因:", err.message);
  }
}
// ===== 提取接口 =====
let extracted = [];

for (const item of rawItems) {
  let apiUrl = null;

  if (isHttp(item.api)) apiUrl = item.api;
  else if (isHttp(item.baseUrl)) apiUrl = item.baseUrl;
  else if (isHttp(item.ext)) apiUrl = item.ext;
  else if (item.ext && isHttp(item.ext.site)) apiUrl = item.ext.site;

  if (apiUrl && !apiUrl.includes(".jar") && !apiUrl.includes("csp_")) {
    extracted.push({
      name: item.name || item.key || "未知",
      api: apiUrl
    });
  }
}

stats.extractedApis = extracted.length;

// ===== 去重 =====
const unique = new Map();
for (const item of extracted) {
  unique.set(item.api, item);
}

let uniqueItems = Array.from(unique.values());

// ===== 测速检测 =====
let validItems = [];

for (const item of uniqueItems) {
  const speed = await testSpeed(item.api);

  if (speed !== null) {
    validItems.push({
      ...item,
      speed
    });
    stats.validApis++;
    console.log("有效:", item.api, speed + "ms");
  } else {
    stats.invalidApis++;
    console.log("失效:", item.api);
  }
}

// ===== 按速度排序 =====
validItems.sort((a, b) => a.speed - b.speed);

// ===== 生成 OmniBox 格式 =====
const omnibox = validItems.map(item => ({
  id: uuid(),
  key: item.name,
  name: item.name,
  api: item.api,
  type: 2,
  isActive: 1,
  time: new Date().toISOString(),
  isDefault: 0,
  remark: "speed:" + item.speed + "ms",
  tags: [],
  priority: 0,
  proxyMode: "none",
  customProxy: ""
}));

// ===== 生成 CMS 纯接口版 =====
const cms = validItems.map(item => ({
  name: item.name,
  api: item.api,
  speed: item.speed
}));

// ===== 输出文件 =====
fs.writeFileSync("omnibox.json", JSON.stringify({ sites: omnibox }, null, 2));
fs.writeFileSync("cms.json", JSON.stringify(cms, null, 2));
fs.writeFileSync("report.json", JSON.stringify(stats, null, 2));

console.log("转换完成");
console.log(stats);
