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
- 分类自选：美股、A股、港股、台股筛选和排序；港股代码别名统一，上柜股票保留 `.TWO`。
- 原生图表：分时、日K、周K、月K，成交量、MA、BOLL、MACD、KDJ、RSI，以及滚轮缩放和拖动。指标使用可获得的历史数据；历史不足时不补造数值。
- 盘口和成交：仅展示来源提供的档位和成交。台股 MIS 最新成交快照不被当作完整逐笔历史；港股没有验证过的五档数据时不生成档位。
- 财务与公司资料：沪深和港股使用东方财富相关接口，TWSE 上市公司使用证交所公开资料。保留报告期、币种和指标定义；缺少同期数据时不计算同比，缺少权益或毛利数据时不替代 ROE 或毛利率。
- 个股资讯：东方财富资讯、A股券商研报及公告，台股鉅亨網资讯及转载重大讯息。逐券商盈利预测标明对应券商，不称为机构一致预期。
- 支持切换红涨绿跌或绿涨红跌配色。

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
- 三地价格预警暂未实现完整后端检查链路，因此不开放创建入口。现有美股预警还需要实时部署、行情和邮件配置。

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
