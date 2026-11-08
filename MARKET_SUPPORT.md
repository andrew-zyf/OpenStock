# Market support

Coverage is defined per exchange, instrument kind and data feature. A supported adapter can still return no data when the upstream source omits fields or is unavailable. Refresh frequency is not a promise about exchange latency.

## Native regional data

| Exchange | Canonical examples | Quote / chart sources | Company / financial data | Depth, trades and flow |
|---|---|---|---|---|
| Shanghai / Shenzhen | `600519.SS`, `000001.SZ` | Tencent; EastMoney for relevant market data | EastMoney F10 for companies | Actual returned levels, trades and trade-size flows only |
| Hong Kong | `09988.HK` | Tencent; actual available EastMoney trades and flow | EastMoney HK datacenter | No fabricated five-tier depth; source omissions stay unavailable |
| TWSE | `2330.TW` | TWSE MIS and cnYES | TWSE OpenAPI listed-company datasets | MIS levels and latest execution snapshot; no inferred institutional flow |
| TPEx | `6488.TWO` | OTC MIS channel; historical chart adapter not yet verified | Not covered by the TWSE listed-company datasets | Actual available MIS levels/snapshot; unsupported features are labeled |
| Beijing | `832982.BJ`, `920982.BJ` | Identity recognized; verified source adapters not yet connected | Unavailable | Unavailable rather than querying SSE, SZSE or US providers |

Indices and ETFs retain their kind. Indices do not request company F10 or claim corporate audit opinions. Not every fund can be classified from a code alone; unknown classifications must not be presented as verified company facts.

HK aliases such as `HKEX:9988`, `9988.HK` and `09988.HK` share one canonical identity. Existing watchlist records are read compatibly; this repair does not run a database migration. `.TW` and `.TWO` remain distinct.

## Chart semantics

- Intraday change uses the actual session's previous close when provided.
- Daily, weekly and monthly bars must represent the advertised OHLCV interval; a year of daily bars is not a five-day chart.
- Indicator history is independent from the displayed window. MA60 and RSI24 require sufficient preceding bars; unavailable values remain absent.
- VWAP is shown only when provided or derived from appropriate traded amount and volume. Close is not a substitute for VWAP.
- Five-day intraday availability depends on the provider. An unavailable period is shown explicitly rather than filled with daily bars under the same label.
- Volume is normalized to shares internally. Display conversions identify hands or Taiwan lots explicitly; Hong Kong uses shares.
- Every chart series carries actual adjustment and provenance. Tencent qfq arrays are forward-adjusted; a bare day/week/month fallback is unadjusted. Yahoo quote OHLC and cnYES close data have unknown adjustment unless verified. Requested and actual intervals/keys are retained, and mixed adjustment arrays are not spliced together.

## US and other markets

US quotes use the existing Finnhub/Tencent paths and Yahoo Finance chart source. Existing US TradingView profile, financial and technical widgets remain in use and are subject to that service's restrictions. The regional native adapters do not establish support for additional global exchanges.

Price alerts support verified CN/HK/TW/US equity and ETF quote paths, excluding BSE, indices and unsupported international exchanges. Creation remains gated by realtime deployment mode. New alerts use sampled crossings rather than an already-satisfied threshold, expire after 1–90 days (default 90), and require configured Inngest jobs and email delivery. Existing records without crossing mode retain their legacy threshold semantics. Stored legacy Binance alerts alone retain a direct Finnhub 24/7 path with real, fresh timestamps; no exchange calendar is fabricated for crypto, and new crypto alerts remain unsupported.

The five-minute checker uses realtime source requests, never hourly UI quote caches. A valid sample needs a positive last-trade price, known source time at most 120 seconds old, the same verified exchange date at observation and check time, and a trading session at the source observation time. A fresh trade immediately before a lunch/close boundary can still be checked after that boundary. Missing/future times and previous-close references are rejected. An absent initial baseline is seeded without firing. A single-document atomic update records crossing and pending delivery; delivery status is tracked separately. Failed/skipped mail does not erase or rearm a trigger. A crash after claiming delivery can leave an uncertain pending event; exactly-once email delivery is not promised. Sampling cannot capture all crossings between checks.

## Trading calendars, observations and discovery

- Regular cash-market phases include auctions, continuous trading, lunch breaks, closing auctions, holidays and closures. `lib/market/calendar.ts` contains official-source 2026 snapshots for SSE/SZSE/BSE/HKEX/TWSE/TPEx/NYSE, including half days. Outside coverage, scheduled weekday phases are marked unverified and cannot authorize alerts. These schedules do not assert real-time suspension/weather status or extended-hours execution.
- Watchlist groups, reasons, invalidation criteria, target observation prices and review state persist per authenticated user with optimistic concurrency protection. New entries may capture an immutable positive last-trade snapshot with known source times; quote failure does not block addition. Legacy entries do not receive invented snapshots. Observation-price changes are unadjusted price comparisons and exclude fees and corporate-action adjustments.
- Benchmark comparisons are differences of quoted daily returns, in percentage points. They require matching market, currency, source and exchange date, with source times within two minutes. ETFs are explicit proxies. BSE and TPEx currently have no verified benchmark choices.
- HK discovery reads at most five code-ascending pages (100 records each), retaining only 0-prefixed codes. It is a partial securities sample that may include funds, never full-market breadth or an industry index. TW discovery joins TWSE daily prices to the official listed-company roster, excluding OTC and funds; it uses source dates, with official industry codes preserved. Old/unknown dates and missing changes are excluded from breadth. Industry averages are equally weighted sample changes, and constituent links stay local.
- Watchlist-related news is separate from broad market news. Targeted retrieval covers up to 12 symbols, with four concurrent requests and a six-second source timeout; remaining symbols use feed screening with coverage disclosed. Unknown publication times remain unknown.

## Freshness and failures

`asOf` denotes source observation time; `fetchedAt` denotes retrieval time. Unknown source times stay unknown. Closed-session data retains its original date, including when fetched on a weekend.

Quote clients use hourly polling in cached mode and 15-second polling in realtime mode. Charts, books, sectors and news have separate policies aligned with source caching. Hidden tabs pause polling. A failed update can retain a previous successful observation with a stale/error indication.

Optional fundamentals must not discard a valid quote. Financial values retain source currency, units and report period; operating margin, gross margin, net margin and ROE are distinct. Missing financials do not imply a favorable audit opinion.

## Verifying support

Run `npm run verify` and `npm run build`. Offline fixtures establish parser and semantic behavior, not universal live coverage. Check representative instruments through the running app and compare displayed values, timestamps and units with the upstream response. External schema checks should be bounded and kept separate from deterministic tests.
