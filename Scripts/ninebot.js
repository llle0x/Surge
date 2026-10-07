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
  const legacy = String($persistentStore.read(STORE_KEY) || "")
    .split(";").map(item => item.trim()).filter(Boolean)
    .map(item => {
      const colon = item.indexOf(":");
      return colon > 0 ? {
        deviceId: item.slice(0, colon),
        token: item.slice(colon + 1)
      } : null;
    }).filter(account => account && account.token);
  if (legacy.length) return legacy;

  // Recover Authorization saved by the previous Surge version.
  // An access-token alone is not treated as the original Authorization.
  try {
    const saved = JSON.parse($persistentStore.read(STORE_V2_KEY) || "null");
    if (!Array.isArray(saved)) return [];
    return saved.filter(account => account && account.deviceId).map(account => ({
      deviceId: account.deviceId,
      token: account.authorization ||
        (account.tokenHeader === "authorization" ? account.token : "")
    })).filter(account => account.token);
  } catch (_) {
    return [];
  }
}

function serializeAccounts(accounts) {
  return accounts.map(account => account.deviceId + ":" + account.token).join(";");
}

function notify(subtitle, body) {
  console.log(TITLE + " | " + subtitle + "\n" + body);
  $notification.post(TITLE, subtitle, body);
}

function capture() {
  const request = $request || {};
  const url = request.url || "";
  if (!/^https:\/\/cn-cbu-gateway\.ninebot\.com\/(?:portal|app-api)\/api\/user-sign\//i.test(url) ||
      String(request.method || "GET").toUpperCase() === "OPTIONS") return $done({});

  const headers = request.headers || {};
  const token = header(headers, "authorization");
  const deviceId = header(headers, "device_id") || header(headers, "device-id");
  if (!token || !deviceId) {
    console.log("Ninebot capture: missing Authorization or device_id");
    return $done({});
  }

  const accounts = readAccounts();
  const index = accounts.findIndex(account => account.deviceId === deviceId);
  const next = { deviceId, token };
  if (index >= 0) accounts[index] = next;
  else accounts.push(next);
  const saved = serializeAccounts(accounts);
  if ($persistentStore.read(STORE_KEY) === saved) return $done({});
  if ($persistentStore.write(saved, STORE_KEY)) {
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
  headers.device_id = account.deviceId;
  headers.Authorization = account.token;
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
  if (Number(after.code) !== 0) throw new Error(after.msg || "签到后状态查询失败");
  if (Number(after.data && after.data.currentSignStatus) !== 1) {
    throw new Error("签到接口已返回，但复查仍未签到");
  }
  const finalDays = Number(after.data && after.data.consecutiveDays) || days + 1;
  return `成功 | 连签 ${finalDays} 天${rewards ? ` | ${rewards}` : ""}`;
}

async function runCron() {
  console.log("Ninebot cron triggered: " + (typeof $cronexp === "string" ? $cronexp : "manual"));
  const accounts = readAccounts();
  console.log("Ninebot accounts loaded: " + accounts.length);
  if (!accounts.length) {
    notify("未配置有效账号", "恢复抓取脚本和 MITM，打开九号 App 签到页重新抓取 Authorization");
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
