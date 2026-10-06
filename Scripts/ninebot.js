/**
 * 九号出行签到 · Surge
 * Based on the Ninebot sign-in flow by 凉心 (52Lxcloud/ScriptKit).
 * Credentials stay in Surge's local persistent store and are never logged.
 */

const TITLE = "九号出行签到";
const STORE_KEY = "Ninebot.Accounts";
const STORE_V2_KEY = "Ninebot.Accounts.SurgeV2";
const API = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2";

function header(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name);
  return key ? String(headers[key]).trim() : "";
}

function readAccounts() {
  const saved = $persistentStore.read(STORE_V2_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed.filter(a => a && a.deviceId && a.token);
    } catch (_) { /* Fall back to the original storage format. */ }
  }
  return String($persistentStore.read(STORE_KEY) || "")
    .split(";").map(item => item.trim()).filter(Boolean)
    .map(item => {
      const colon = item.indexOf(":");
      return colon > 0 ? {
        deviceId: item.slice(0, colon),
        token: item.slice(colon + 1),
        tokenHeader: "authorization"
      } : null;
    }).filter(Boolean);
}

function notify(subtitle, body) {
  $notification.post(TITLE, subtitle, body);
}

function capture() {
  const request = $request || {};
  const url = request.url || "";
  if (!/^https:\/\/cn-cbu-gateway\.ninebot\.com\/(?:portal|app-api)\/api\/user-sign\//i.test(url) ||
      String(request.method || "GET").toUpperCase() === "OPTIONS") return $done({});

  const headers = request.headers || {};
  const accessToken = header(headers, "access-token");
  const authorization = header(headers, "authorization");
  const token = accessToken || authorization;
  const tokenHeader = accessToken ? "access-token" : "authorization";
  const hyphenDeviceId = header(headers, "device-id");
  const deviceId = hyphenDeviceId || header(headers, "device_id");
  if (!token || !deviceId) return $done({});

  const accounts = readAccounts();
  const index = accounts.findIndex(a => a.deviceId === deviceId);
  const next = { deviceId, token, tokenHeader, deviceHeader: hyphenDeviceId ? "device-id" : "device_id" };
  if (accessToken && authorization) next.authorization = authorization;
  if (index >= 0 && accounts[index].token === token &&
      accounts[index].tokenHeader === tokenHeader &&
      accounts[index].authorization === next.authorization &&
      accounts[index].deviceHeader === next.deviceHeader) {
    return $done({});
  }
  if (index >= 0) accounts[index] = next;
  else accounts.push(next);
  if ($persistentStore.write(JSON.stringify(accounts), STORE_V2_KEY)) {
    notify("Token 已保存", `账号 ${accounts.length} 个`);
  } else {
    notify("Token 保存失败", "请检查 Surge 持久化存储");
  }
  $done({});
}

function request(path, account, method, body) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    language: "zh",
    "from_platform_1": "1",
    Origin: "https://h5-bj.ninebot.com",
    Referer: "https://h5-bj.ninebot.com/",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6"
  };
  headers[account.deviceHeader === "device-id" ? "device-id" : "device_id"] = account.deviceId;
  headers[account.tokenHeader === "access-token" ? "access-token" : "Authorization"] = account.token;
  if (account.authorization) headers.Authorization = account.authorization;
  const options = { url: API + path, headers, timeout: 15 };
  if (body !== undefined) options.body = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    $httpClient[method](options, (error, response, data) => {
      if (error) return reject(new Error("网络请求失败"));
      const status = Number(response && (response.status || response.statusCode));
      if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status || "?"}`));
      try { resolve(JSON.parse(data)); }
      catch (_) { reject(new Error("接口返回不是 JSON")); }
    });
  });
}

async function signIn(account) {
  const status = await request(`/status?t=${Date.now()}`, account, "get");
  if (Number(status.code) !== 0) throw new Error(status.msg || "状态查询失败");
  const days = Number(status.data && status.data.consecutiveDays) || 0;
  if (Number(status.data && status.data.currentSignStatus) === 1) return `已签到 | 连签 ${days} 天`;

  const signed = await request("/sign", account, "post", { deviceId: account.deviceId });
  if (Number(signed.code) !== 0) throw new Error(signed.msg || "签到失败");
  const rewards = ((signed.data && signed.data.rewardList) || [])
    .map(item => item.rewardValue ? `+${item.rewardValue} N币` : "").filter(Boolean).join(" ");
  const after = await request(`/status?t=${Date.now()}`, account, "get");
  const finalDays = Number(after.data && after.data.consecutiveDays) || days + 1;
  return `成功 | 连签 ${finalDays} 天${rewards ? ` | ${rewards}` : ""}`;
}

async function runCron() {
  console.log("Ninebot cron triggered: " + (typeof $cronexp === "string" ? $cronexp : "manual"));
  const accounts = readAccounts();
  if (!accounts.length) {
    notify("未配置账号", "打开九号 App 签到页抓取 Token");
    return $done();
  }
  const results = [];
  for (let i = 0; i < accounts.length; i++) {
    try { results.push(`账号 ${i + 1}: ${await signIn(accounts[i])}`); }
    catch (error) { results.push(`账号 ${i + 1}: ${error.message || "签到失败"}`); }
  }
  notify("签到结果", results.join("\n"));
  $done();
}

const isRequest = typeof $script !== "undefined" && $script.type === "cron"
  ? false
  : typeof $request !== "undefined";
if (isRequest) capture();
else runCron().catch(error => {
  notify("签到失败", error.message || "未知错误");
  $done();
});
