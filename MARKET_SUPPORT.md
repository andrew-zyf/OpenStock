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

- Regular cash-market phases include auctions, continuous trading, lunch breaks, closing auctions, holidays and closures. `lib/market/calendar.ts` contains official-source 2026 snapshots for SSE/SZSE/BSE/HKEX/TWSE/TPEx/NYSE, plus verified 2027 HKEX and NYSE holidays and half days. Mainland China and Taiwan 2027 remain unverified. Coverage end, review date and renewal needs are exposed; outside coverage, scheduled weekday phases cannot authorize alerts. These schedules do not assert real-time suspension/weather status or extended-hours execution. Trading context explains local dates and rules without assigning unverified security-specific board lots or limit percentages.
- Watchlist groups, reasons, invalidation criteria, target observation prices and review state persist per authenticated user with optimistic concurrency protection. New entries may capture an immutable positive last-trade snapshot with known source times; quote failure does not block addition. Legacy entries do not receive invented snapshots. Observation-price changes are unadjusted price comparisons and exclude fees and corporate-action adjustments.
- Benchmark comparisons are differences of quoted daily returns, in percentage points. They require matching market, currency, source and exchange date, with source times within two minutes. ETFs are explicit proxies. BSE and TPEx currently have no verified benchmark choices.
- Historical comparison is a separate contract: matching market, currency and Tencent kline source, with both actual `qfqday`/forward or both actual `day`/unadjusted provenance. The default CN historical proxy is the verified `510300.SS` ETF path; daily benchmark defaults are unchanged. At most 20 common close dates are indexed to 100; at least two are required, unmatched days are not filled, and today's unconfirmed daily bar is excluded. A full table and partial-window notice accompany returns and percentage-point differences. Unknown Yahoo/cnYES adjustment and mixed provenance are rejected. These are price returns, excluding total-return, fees, FX and reinvestment claims.
- Observation changes retain append-only revisions; reviews use an explicit market calendar date, optional evidence links and correction chains that preserve original text. Updating a review's next-review date atomically updates the current plan; an omitted date preserves it and explicit null clears it. History is paginated across canonical aliases, excluded from ordinary list reads, and fails explicitly at the document capacity limit rather than silently truncating records. Legacy modification times remain unknown when not recorded.
- The review queue evaluates due dates in each instrument's market time zone. Key-price distance requires a non-stale, positive last trade with real source time no more than 120 seconds old and a verified trading phase. A near-price cue is not a sampled crossing, and a weekend close is not described as a current intraday touch.
- CN sector drill-down requests actual EastMoney `BK` constituents on expansion, up to three pages of 100 members, with bounded concurrency and timeouts. Source count changes, missing quotes, unknown/different dates and truncated pagination are disclosed as partial samples; breadth excludes invalid observations. Watchlist markers are fetched once for the page rather than issuing a database lookup per member.
- HK discovery reads at most five code-ascending pages (100 records each), retaining only 0-prefixed codes. It is a partial securities sample that may include funds, never full-market breadth or an industry index. TW discovery joins TWSE daily prices to the official listed-company roster, excluding OTC and funds; it uses source dates, with official industry codes preserved. Old/unknown dates and missing changes are excluded from breadth. Industry averages are equally weighted sample changes, and constituent links stay local.
- Watchlist-related news is separate from broad market news. Targeted retrieval covers up to 12 symbols, with four concurrent requests and a six-second source timeout; remaining symbols use feed screening with coverage disclosed. Unknown publication times remain unknown.

## Event calendar

Automatic events cover the next seven calendar dates in each instrument's exchange zone. TWSE `TWT48U_ALL` ex-dividend rows are official schedules that may change; EastMoney `RPT_PUBLIC_BS_APPOIN` appointments for SSE/SZSE equities are estimates, not evidence of actual publication. Source failures are distinct from valid empty responses. Other markets and security types have no verified automatic event adapter and are disclosed as unsupported.

Authenticated users can create and cancel their own manual events for watchlist instruments, with bounded text, valid calendar dates and HTTP(S) evidence links without embedded credentials. Official links do not promote manual records to confirmed status. Request IDs deduplicate retries; cancellation preserves the stored record. Up to 100 active manual records are shown independently of the automatic seven-day window; removed watchlist symbols retain their manual events so users can still cancel them. Evidence URLs are links only and are never fetched by the server.

## Research lifecycle and backup

Removing a watch archives owned aliases instead of deleting their journals. Restoring preserves saved identity, initial snapshot and append-only evidence. Active reads and the news digest exclude archives; archives retain read-only journal access. Archive/restore advance the journal version and fence concurrent edits. A persisted per-user lifecycle mutex serializes membership mutations and coordinated reads on standalone MongoDB; it has no automatic expiry or lock stealing. A crashed writer or an uncertain partial write fails closed with a maintenance-required error instead of exposing a mixed alias state. Recovery requires stopping the writer, inspecting the recorded operation and aliases, and deliberately reconciling that operation before clearing its exact lock token; it is not an automatic retry or a background migration. Structured `JOURNAL_CAPACITY` means the entire attempted write was rejected; drafts remain available and the JSON export does not truncate or free history.

JSON backup v1 exports raw alias records, complete journal/correction relationships, snapshots, manual events including cancellations, and allowlisted alert reference data. Import validates the version and nested content, previews conflicts, then rechecks inside MongoDB transactions. Existing canonical identities are skipped as a group; missing research is imported archived. Retries do not duplicate records. No alert is imported, rearmed or delivered. Transactions require a replica set or compatible cluster; unsupported standalone imports fail without partial writes. Files are limited to 32 MiB and each research document to 12 MiB BSON. Manual plans, peer groups and change state are outside backup v1's scope.

Alerts and manual events remain independent of research membership. Archiving does not stop detection; explicit pause changes only future active sampling, preserving trigger/delivery evidence. An already recorded trigger or in-flight mail is not recalled by pause.

## Retained changes, completed-day research and manual plans

The change inbox derives observation revisions and market-local due dates from retained research. CN appointment events use stable instrument/report-period/type identity; their observed dates are versioned per user and date changes carry before/after values and discovery time. First observations establish a baseline. Missing results, request errors, membership changes and departure from the seven-day window do not establish withdrawal. The current TWSE feed lacks a verified stable event identity, so it remains calendar-only. No withdrawal is fabricated. Handled, ignored and snoozed states belong to a concrete change version and use optimistic concurrency; a new version remains actionable. Reads are bounded and disclose clipping. The inbox does not establish current source health or comprehensive market coverage.

Daily research is loaded on demand for at most 20 members. Five and twenty trading intervals require six and twenty-one shared completed close points respectively, under the verified Tencent actual-source/adjustment/currency contract. All compatible members use one common date intersection; missing dates are not filled. Today's exchange-local bar is conservatively excluded until the next local date. Volume compares the most recent completed day with the preceding twenty completed-day volumes in shares; missing values and zero medians prevent an invented ratio. This is not an intraday volume ratio, total return or historical sector-ranking system. Fixed peer groups preserve the user's chosen identities and membership-save time, including after removal from watchlists; viewing their earlier prices is explicitly a retrospective comparison of the saved list.

Manual plans keep waiting conditions, invalidation conditions, next actions and a market-local check date in a separate user-owned book, capped at 100 retained plans. Completed and cancelled records remain stored. Plan state neither changes review validity nor asserts positions, executions or automatic orders.

## Freshness and failures

`asOf` denotes source observation time; `fetchedAt` denotes retrieval time. Unknown source times stay unknown. Closed-session data retains its original date, including when fetched on a weekend.

Quote clients use hourly polling in cached mode and 15-second polling in realtime mode. Charts, books, sectors and news have separate policies aligned with source caching. Hidden tabs pause polling. A failed update can retain a previous successful observation with a stale/error indication.

The detail header and dynamic quote statistics share one observed quote. Replacing it clears fields absent from the new observation; a failed request retains the entire prior quote with its original source/retrieval times and stale indication. Market cap and PE/PB are independent page-load reference data, not claimed to be part of the refreshing quote.

Alert health records come from real scheduled attempts, not page reads. The authenticated summary exposes only status and start/completion/failure times, with a five-minute expected interval and a fifteen-minute overdue threshold; run IDs and internal errors are not exposed. Updates fence overlapping runs so older finishes cannot overwrite newer attempts. Recent completion is evidence of a recorded run, not a continuous-worker or email-delivery guarantee; cached mode remains paused and absent heartbeats remain unknown.

Optional fundamentals must not discard a valid quote. Financial values retain source currency, units and report period; operating margin, gross margin, net margin and ROE are distinct. Missing financials do not imply a favorable audit opinion.

## Verifying support

Run `npm run verify` and `npm run build`. Offline fixtures establish parser and semantic behavior, not universal live coverage. Check representative instruments through the running app and compare displayed values, timestamps and units with the upstream response. External schema checks should be bounded and kept separate from deterministic tests.
