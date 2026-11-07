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

## US and other markets

US quotes use the existing Finnhub/Tencent paths and Yahoo Finance chart source. Existing US TradingView profile, financial and technical widgets remain in use and are subject to that service's restrictions. The regional native adapters do not establish support for additional global exchanges.

Price alert creation remains limited by the existing backend and deployment mode. CN/HK/TW alerts are not enabled merely because quote pages work. US alerts require supported Finnhub quotes, realtime mode, configured background jobs and email delivery.

## Freshness and failures

`asOf` denotes source observation time; `fetchedAt` denotes retrieval time. Unknown source times stay unknown. Closed-session data retains its original date, including when fetched on a weekend.

Quote clients use hourly polling in cached mode and 15-second polling in realtime mode. Charts, books, sectors and news have separate policies aligned with source caching. Hidden tabs pause polling. A failed update can retain a previous successful observation with a stale/error indication.

Optional fundamentals must not discard a valid quote. Financial values retain source currency, units and report period; operating margin, gross margin, net margin and ROE are distinct. Missing financials do not imply a favorable audit opinion.

## Verifying support

Run `npm run verify` and `npm run build`. Offline fixtures establish parser and semantic behavior, not universal live coverage. Check representative instruments through the running app and compare displayed values, timestamps and units with the upstream response. External schema checks should be bounded and kept separate from deterministic tests.
