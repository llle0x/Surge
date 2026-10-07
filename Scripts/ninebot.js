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

function validateAccount(account) {
  const deviceId = typeof account.deviceId === "string" ? account.deviceId.trim() : "";
  const token = typeof account.token === "string" ? account.token.trim() : "";
  if (!deviceId || /[\s\x00-\x1f\x7f:;"'{}\[\]]/.test(deviceId) ||
      !token || /[\x00-\x1f\x7f;]/.test(token) || /^[{\["]/.test(token)) {
    throw new Error("九号账号数据格式异常，已停止请求；原数据未被覆盖");
  }
  return { deviceId, token };
}

function decodeStored(value) {
  // The original storage wrapper decodes JSON before reading credentials.
  // Accept raw legacy text and JSON-encoded text without treating quotes as IDs.
  let decoded = value;
  for (let i = 0; i < 3 && typeof decoded === "string"; i++) {
    const text = decoded.trim();
    if (!/^["{\[]/.test(text)) return text;
    try { decoded = JSON.parse(text); }
    catch (_) { throw new Error("九号账号 JSON 无效，原数据未被覆盖"); }
  }
  return decoded;
}

function parseStoredAccounts(raw, v2) {
  if (!raw || !String(raw).trim()) return [];
  const saved = decodeStored(raw);
  if (typeof saved === "string" && !v2) {
    return saved.split(";").map(item => item.trim()).filter(Boolean).map(item => {
      const colon = item.indexOf(":");
      if (colon <= 0) throw new Error("九号账号缺少设备 ID 或 Authorization，原数据未被覆盖");
      return validateAccount({ deviceId: item.slice(0, colon), token: item.slice(colon + 1) });
    });
  }
  if (!Array.isArray(saved)) throw new Error("九号账号格式不受支持，原数据未被覆盖");
  return saved.map(account => {
    if (!account || typeof account !== "object") throw new Error("九号账号数据格式异常，原数据未被覆盖");
    // Never substitute access-token for the original Authorization.
    const token = account.authorization ||
      ((!account.tokenHeader || account.tokenHeader === "authorization") ? account.token : "");
    if (!token) throw new Error("账号缺少 Authorization，请恢复抓取脚本和 MITM 后重新抓取");
    return validateAccount({ deviceId: account.deviceId, token });
  });
}

function readAccounts() {
  const legacy = parseStoredAccounts($persistentStore.read(STORE_KEY), false);
  if (legacy.length) return legacy;
  return parseStoredAccounts($persistentStore.read(STORE_V2_KEY), true);
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

  let accounts;
  try {
    validateAccount({ deviceId, token });
    accounts = readAccounts();
  } catch (error) {
    notify("Token 未保存", error.message);
    return $done({});
  }
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

async function checkResponse(stage, path, account, method, body) {
  let result;
  try { result = await request(path, account, method, body); }
  catch (error) { throw new Error(stage + "：" + error.message); }
  if (!result || typeof result !== "object" || result.code === undefined ||
      result.code === null || Number(result.code) !== 0) {
    const code = result && result.code !== undefined ? String(result.code) : "缺失";
    // Only report the result code and message; credentials are never logged.
    const message = result && typeof result.msg === "string" ? result.msg : "接口返回异常";
    throw new Error(`${stage}（code=${code}）：${message}`);
  }
  return result;
}

async function signIn(account) {
  const status = await checkResponse("查询签到状态失败", `/status?t=${Date.now()}`, account, "get");
  const days = Number(status.data && status.data.consecutiveDays) || 0;
  if (Number(status.data && status.data.currentSignStatus) === 1) return `已签到 | 连签 ${days} 天`;

  const signed = await checkResponse("提交签到失败", "/sign", account, "post", { deviceId: account.deviceId });
  const rewards = ((signed.data && signed.data.rewardList) || [])
    .map(item => item.rewardValue ? `+${item.rewardValue} N币` : "").filter(Boolean).join(" ");
  const after = await checkResponse("复查签到状态失败", `/status?t=${Date.now()}`, account, "get");
  if (Number(after.data && after.data.currentSignStatus) !== 1) {
    throw new Error("签到接口已返回，但复查仍未签到");
  }
  const finalDays = Number(after.data && after.data.consecutiveDays) || days + 1;
  return `成功 | 连签 ${finalDays} 天${rewards ? ` | ${rewards}` : ""}`;
}

async function runCron() {
  console.log("Ninebot v2026.10.07.1 cron triggered: " + (typeof $cronexp === "string" ? $cronexp : "manual"));
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
