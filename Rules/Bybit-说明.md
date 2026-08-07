# Bybit Surge 规则说明

来源：[NodeSeek「分享 Bybit 分流域名规则」](https://www.nodeseek.com/post-258950-1)，帖子标题标注更新于 2025-02-11。本目录于 2026-08-07 按 Surge `RULE-SET` 格式整理。

## 文件选择

- `Bybit.list`：推荐。仅包含原帖中的 Bybit 专属域名，适合作为长期默认规则。
- `Bybit-Full.list`：原帖完整兼容版。额外包含 Amazon、Firebase、AppsFlyer 等共享域名及 7 条固定 IP；只建议在推荐版出现登录、行情、交易或 Web3 功能异常时测试。

原帖规则中的策略名称和域名规则后的 `no-resolve` 已移除，因为远程 `RULE-SET` 文件只保存匹配条件，策略应由主配置指定；`no-resolve` 仅保留在 IP 规则中。

## Surge 引用方式

推荐规则应放在通用代理规则之前，并使用台湾节点：

```ini
RULE-SET,https://raw.githubusercontent.com/nihcuijp/Surge/main/Rules/Bybit.list,🇹🇼 台湾节点
```

若推荐版无法正常登录或使用部分功能，可临时替换为：

```ini
RULE-SET,https://raw.githubusercontent.com/nihcuijp/Surge/main/Rules/Bybit-Full.list,🇹🇼 台湾节点
```

## 注意事项

- 不建议为这些规则使用美国节点；Bybit 的服务可用地区与账户合规要求仍以官方规则为准。
- 完整版中的固定 IP 属于原帖当时抓取结果，CDN 或云服务 IP 可能变化或被复用，失效时优先回到推荐版并重新排查域名。
- 规则采用从上到下匹配，应放在 `FINAL` 之前；不要在规则集文件里加入 `FINAL`。
