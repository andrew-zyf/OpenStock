<p align="center"><sub><a href="https://www.rapidproxy.io/?ref=openstock">SPONSORED BY</a></sub></p>

<p align="center">
  <a href="https://www.rapidproxy.io/?ref=openstock"><img src="public/assets/images/rapidproxy-banner.png" alt="RapidProxy: try for free, 90M+ clean residential IPs" width="420"></a>
</p>

<p align="center">
  <a href="https://github.com/diip3sh/orbit"><picture><source media="(prefers-color-scheme: dark)" srcset="public/assets/icons/orbit.png"><img src="public/assets/icons/orbit-black.png" alt="" height="20"></picture></a> <a href="https://github.com/diip3sh/orbit"><b>Orbit</b></a>. Free, open-source macOS screen recorder, screenshot tool and video editor: auto-zoom, smooth cursor, backgrounds, web recordings and AI agent recording.
</p>

# OpenStock 中文与多市场分支

[当前分支](https://github.com/andrew-zyf/OpenStock/tree/feat/chinese-market-enhancements) · [上游项目](https://github.com/Open-Dev-Society/OpenStock) · [市场支持范围](MARKET_SUPPORT.md)

OpenStock 是基于 Next.js、React、TypeScript 和 MongoDB 的开源股票观察工具。本分支提供美股、A股、港股、台股的本地行情页面、分类自选和中文资讯。A股、港股、台股页面采用原生图表和地区数据接口；美股保留现有 Finnhub、Yahoo Finance 和部分 TradingView 组件。

**数据按来源实际返回情况展示。** 公共接口不保证逐标的覆盖、稳定性或零延迟。刷新间隔表示客户端检查频率，不代表交易所行情延迟。未提供的盘口、财务指标、成交方向和资金分类显示缺失，不使用构造记录补齐。

## 功能

- 市场概览：四地资产速览、本地股票详情导航、精选报价和异动排行。A股行业板块榜与宏观信息有明确市场标记。
- 自选观察工作台：四地市场筛选、自定义分组、观察理由、失效条件、关键价位和复核状态保存在数据库；支持并发冲突提示。观点修改保留版本，复核按市场日期追加，错误记录通过更正链保留原文；填写下次复核日期会同步进入到期待办。新加入时可记录真实成交价快照，旧记录不补造历史。
- 待复核队列：按标的市场日期筛选到期事项，可按距关键价排序并查看入队依据。价格线索仅采用交易中、日历已核验且 120 秒内的有效成交观察；接近关键价不等于已发生跨价。
- 自选事件日程：筛选未来 7 个市场当地自然日的 TWSE 除权息官方预告与沪深预约披露，分别标注“可能变更”和“尚未确认披露”；用户记录独立保留、可撤销，参考官方链接也不自动成为已核验事件。未接入市场明确提示覆盖不足。
- 自选资讯：相关资讯与全市场资讯分开，显示关联标的、匹配依据、来源状态与检索覆盖；最多 12 只定向检索，其余按综合资讯筛选。
- 相对走势：同市场标的与明确基准比较当日来源涨跌幅差，单位为百分点。新增历史区间比较，取最近最多 20 个共同收盘日期、归一到 100，并显示可核对表格；要求实际来源与复权口径一致。A股默认采用已核验的沪深300 ETF（510300）代理，其他未核验路径暂停比较。
- 行业与市场发现：A股行业榜可按需展开真实板块成员，每行业最多三页、每页 100 条，标记已有自选并导航本地详情；超限或缺失数据明确标为样本。港股固定代码排序的前五页来源样本，台股 TWSE 上市公司日终样本，也支持行业展开。
- 原生图表：分时、日K、周K、月K，成交量、MA、BOLL、MACD、KDJ、RSI，以及滚轮缩放和拖动。指标使用可获得的历史数据；历史不足时不补造数值。
- 盘口和成交：仅展示来源提供的档位和成交。台股 MIS 最新成交快照不被当作完整逐笔历史；港股没有验证过的五档数据时不生成档位。
- 财务与公司资料：沪深和港股使用东方财富相关接口，TWSE 上市公司使用证交所公开资料。保留报告期、币种和指标定义；缺少同期数据时不计算同比，缺少权益或毛利数据时不替代 ROE 或毛利率。
- 个股资讯：东方财富资讯、A股券商研报及公告，台股鉅亨網资讯及转载重大讯息。逐券商盈利预测标明对应券商，不称为机构一致预期。
- 支持切换红涨绿跌或绿涨红跌配色。

## 研究资料与日常任务

- 移出自选现在归档研究，保留初始快照、观点历史、复核和更正关系；可在「研究归档」查看历史并恢复关注。归档后须先恢复才能继续修改。普通列表和资讯摘要只读取关注中的记录。
- 本机单机 MongoDB 支持归档和恢复。跨请求协调不会自动抢占旧锁；若写进程崩溃或部分写入结果不明，会停止后续研究操作并要求管理员核查，避免展示混合别名状态。旧别名仍按原数据库记录计入关注容量。
- 预警、用户事件和人工计划独立存续。归档不自动停用预警；归档区和预警区可单独停用后续检测，保留触发及投递记录，已在途的投递不会被撤回。
- 「研究备份与导入」提供版本化 JSON：包含全部活跃及归档研究的原始别名、完整 journal、快照、用户事件（含撤销）及预警参考。导入先校验、预览，再确认；已有标的整组跳过，缺少的研究默认归档，不重建预警。导入需要支持事务的 MongoDB，文件上限 32 MiB；单条研究仍受 12 MiB BSON 保护。v1 不包含人工计划、同业组或变化处理记录；导出不会自动释放历史容量。
- 「自上次处理后的变化」汇总已留存的沪深预约改期、观点版本修改和到期计划，展示前后字段，并持久保存已处理、24 小时后核查或忽略本次。新变化有新身份；来源失败、空结果或离开七日窗口都不会被猜作撤回。TWSE 当前缺少稳定事件标识，暂不提供改期追踪；收件箱不承担完整市场数据健康监控。
- 「盘后量价与我的同业组」按需读取最多 20 个成员。5／20 个交易间隔分别要求 6／21 个共同完成日收盘点，来源、实际复权与币种必须可比；成交量以最近完成日对前 20 完成日中位数比较。自定义组固定保存名单及时间，不产生历史行业排名，美股与台股未知复权路径暂停比较。
- 盘前、盘中、盘后任务入口分别指向变化与期限、数据与关键价、量价与同业。人工计划单独记录等待条件、失效条件、下一步与检查日期；最多累计 100 条，完成和取消均保留，状态不代表持仓或成交。
- 市场概览的成交额、涨跌家数及汇率分别说明来源、时间和覆盖。缺失不转成 0，缺少任一市场成交额时不展示完整沪深合计；资金分类不推断机构身份，绝对成交额不推断放量。

## 数据源与支持边界

| 市场 | 报价与图表 | 财务和公司资料 | 当前限制 |
|---|---|---|---|
| 沪深 A股 | 腾讯行情、东方财富成交与资金分类接口 | 东方财富 F10 | 来源可能缺字段；指数不显示上市公司财报 |
| 港股 | 腾讯行情，东方财富可用的成交与资金数据 | 东方财富港股数据中心 | 不构造免费源缺失的五档盘口；财报币种按报告自身标记 |
| TWSE 上市 | TWSE MIS、cnYES 图表 | TWSE OpenAPI | MIS 快照不等于逐笔历史；无真实资金分类时不展示主力流向 |
| TPEx 上柜 | 保留 OTC 身份，使用对应 MIS 通道；历史图表尚未接入经验证的来源 | 当前不使用 TWSE 上市公司清单冒充 TPEx 资料 | 未接入的图表、财务和公司资料显示不可用 |
| 北交所 | 正确识别 `.BJ` 和对应市场身份 | 尚未接入经验证的适配器 | 不发送到沪深或美股接口，不承诺数据覆盖 |
| 美股 | Finnhub、Yahoo Finance，腾讯报价补充 | 现有 Finnhub 与 TradingView 功能 | Finnhub 功能取决于 Key、套餐和部署设置 |

完整边界见 [MARKET_SUPPORT.md](MARKET_SUPPORT.md)。ETF 与指数按资产类型处理，不生成公司注册资料或审计结论。台股每日估值、公司股本和盘中报价来自不同数据集，日期可能不同。

## 数据口径与刷新

- 金额在来源入口转换为计价货币的绝对金额；市值格式化不根据数值大小猜测单位。
- 统一行情数量以股计；界面展示 A股手数或台股张数时明确换算（100 股/手、1000 股/张），港股以股显示。
- `asOf` / 行情时间来自数据源；`fetchedAt` 是取回时间。未知行情时间不会被设置为当前交易时间。
- `NEXT_PUBLIC_OPENSTOCK_DATA_MODE=cached` 为默认报价模式，已挂载页面按小时检查；`realtime` 报价按 15 秒检查。
- 图表、盘口、板块和资讯分别遵循其来源缓存频率。分时图表通常按 30 秒检查，历史图表按小时检查，资讯按分钟级检查。
- 隐藏标签页暂停自动请求；恢复可见时检查到期数据。刷新失败时保留最近成功数据并显示状态；同一图表刷新不重置手动缩放和平移。
- 详情页价格、成交量、成交额、换手率及高低价共享同一份报价观察；新观察缺少字段时显示缺失，不沿用旧报价的统计。市值、PE/PB 等另列为加载时参考，不宣称同步实时。
- 交易阶段区分竞价、连续交易、午休与休市；节假日及半日市使用带官方出处的 2026 年日历快照，并已补充官方 2027 年港股、美股日历。沪深北及台湾 2027 年仍为未核验；页面显示覆盖与维护状态，不推算节假日。计划时段不代表实时停牌或天气状态；交易规则说明也不冒充逐证券已核验的手数或涨跌停限制。
- 图表展示实际复权口径与来源周期：腾讯前复权、回退不复权或来源未确认；请求前复权不等于实际返回前复权。
- 价格提醒已接入受支持的四地股票和 ETF；新提醒按有效报价跨越目标价触发，默认 90 天到期。检查要求 120 秒内的真实成交来源时间、已核验交易日历和交易时段；首次有效样本只建立基线。原子保存触发事件与通知状态，邮件失败不会抹掉触发事实。
- 提醒入口仍要求 `realtime` 部署模式；自动检查需要配置并运行 Inngest 的每五分钟任务，邮件需有效配置。页面显示真实调度记录的开始、完成、失败或超过 15 分钟未完成等状态；读取页面不会生成心跳，最近一次完成也不代表后台持续在线。不保证五分钟采样能捕获期间所有跨价。新代码不会自动修改部署设置或发送测试邮件。

## 本地运行

需要 Node.js 22 和 MongoDB。

```bash
git clone -b feat/chinese-market-enhancements https://github.com/andrew-zyf/OpenStock.git
cd OpenStock
npm ci
cp .env.example .env
```

填写数据库连接和认证配置后运行：

```bash
npm run dev
# http://localhost:3080
```

生产构建与运行：

```bash
npm run verify
npm run build
npm start
# http://localhost:3080
```

主要环境变量（完整说明见 [.env.example](.env.example)）：

| 变量 | 用途 |
|---|---|
| `MONGODB_URI` | MongoDB 连接字符串 |
| `BETTER_AUTH_SECRET` | 使用独立随机生成的会话签名密钥 |
| `BETTER_AUTH_URL` | 部署的公开地址，本地为 `http://localhost:3080` |
| `FINNHUB_API_KEY` | 美股行情及相关功能；三地原生来源不使用此 Key |
| `NEXT_PUBLIC_OPENSTOCK_DATA_MODE` | `cached` 或 `realtime`，在构建时固定，修改后需重新构建 |

Docker Compose：

```bash
docker compose up -d --build
# http://localhost:3000
```

## 检查与测试

```bash
npm run typecheck
npm run lint
npm test
npm run verify
npm run build
```

确定性测试使用模拟 HTTP 响应，覆盖来源单位、标的身份、缺失值与零值、真实时间、可选接口失败隔离、财务指标、图表口径和刷新调度。可选的网络集成测试需要独立配置；离线测试通过不代表所有公共接口在任何地区都可用。

构建启用 TypeScript 和 ESLint 检查。GitHub Actions 在 PR 和本分支推送时验证；镜像发布依赖同一提交的验证任务。本地测试不会发送邮件或自动执行数据库迁移。

## 代码结构

```text
lib/market/instrument.ts     标的识别、交易所与资产类型
lib/market/contracts.ts      来源与时间元数据
lib/market/capabilities.ts   原生功能支持范围
lib/realtime-market.ts       地区行情、图表、盘口和资金解析
lib/actions/                Server Actions 与数据入口
hooks/useMarketResource.ts  按资源隔离的请求和刷新生命周期
components/stocks/          原生图表、财务、盘口和资讯面板
__tests__/                  模拟来源及语义回归测试
```

## License

OpenStock 使用 [AGPL-3.0](LICENSE)。修改、分发或部署时请遵守该许可证并保留原作者署名。本分支基于 [Open Dev Society / OpenStock](https://github.com/Open-Dev-Society/OpenStock)。
