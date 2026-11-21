# Measured benchmarks

## Phase 7 stub delivery pipeline — 2026-11-21

- **Command:** `pnpm exec tsx loadtests/send-500k.js` under Node 22.23.2. The script created a temporary PostgreSQL database, seeded 500,000 synthetic confirmed subscribers, paged the real delivery repository, ran the real sender pipeline with a stub email provider, checked 500,000 `sent` rows, and dropped the database.
- **Hardware:** Apple M5, 10 logical CPUs, 16 GiB host RAM. The local Docker PostgreSQL allocation was not measured.
- **Measured:** subscription seed 7.45 s; 501 fanout calls 13.11 s (38,139 delivery rows/s); sender claim, template, stub send, and batch record 89.95 s (5,559 emails/s); process CPU 0.033 ms/email across the full run. All 500,000 delivery rows finished in `sent` state.
- **Boundary:** The sender harness uses an in-memory receive queue and a permissive rate limiter to isolate raw application and PostgreSQL capacity. It does not measure ElasticMQ/SQS, Redis throttling, a real email provider, or the 2 vCPU demo VM. The deployed sender is capped at 100 sends/s globally and 50 sends/s per publication, and the scheduler takes at most 100 due rows per publication every 15 seconds. Therefore the local raw result does **not** demonstrate 1,000 actual deliveries/s in the demo configuration.

## Phase 7 scheduled slot starts — 2026-11-21

- **Command:** `pnpm exec tsx loadtests/slots.js` under Node 22.23.2. The script created an isolated PostgreSQL database, generated 1,000 scheduled deliveries across morning, afternoon, and evening slots in four timezones, moved that cohort to a common due instant, then invoked the real scheduler and claim repository at the production 15-second cadence with the stub provider.
- **Hardware:** Apple M5, 10 logical CPUs, 16 GiB host RAM. Docker allocation was not measured.
- **Measured:** all 1,000 rows reached the sending claim; 99th percentile start lag was 135.04 seconds; 100% started within five minutes.
- **Boundary:** The time-shifted cohort measures scheduler and PostgreSQL claim start under a 1,000-recipient publication with a raised test daily budget. It excludes SQS delivery, Redis limits, provider latency, and a real slot-hour wall-clock wait. The default publication daily send limit is 100, so the result is not a promise for a larger real campaign. At 100 rows per 15-second tick, a 500,000-recipient cohort for one publication cannot meet the five-minute target without revisiting the scheduler and provider budgets.

## Phase 7 ClickHouse outage burst — 2026-11-21

- **Command:** `pnpm exec vitest run chaos/clickhouse-storm.test.ts --maxWorkers=1 --minWorkers=1` under Node 22.23.2. The test stopped an isolated ClickHouse container, issued 1,000 verified click requests to a local tracking listener with PostgreSQL link lookup, checked every redirect, restarted ClickHouse, and verified 1,000 distinct event IDs in ClickHouse with an empty TrackQ.
- **Hardware:** Apple M5, 10 logical CPUs, 16 GiB host RAM. Docker allocation was not measured.
- **Measured:** 1,000 clicks completed in 225.93 ms (4,426 requests/s during this short burst); all redirects returned 302 and no events were dropped. The test passed after the queue visibility timeout and recovery drain.
- **Boundary:** This was a short local burst, not a sustained 1,000 requests/s run on the planned demo VM. The earlier Phase 5 k6 run measures sustained open pixels, not click redirects.


## Phase 5 open-event ingestion — 2026-11-12

- **Command:** `docker run --rm --env-file /tmp/vichaar-phase5-k6.env -v /Users/saksham/PROJECTS/Vichaar/loadtests/events.js:/loadtest.js:ro grafana/k6:latest run /loadtest.js`. The env file contained a signed open token and `TRACKING_BASE_URL=http://host.docker.internal:4001`; no token value is recorded here.
- **Hardware:** Mac17,3, 10 logical CPUs, 16 GiB host RAM. Docker resource allocation was not measured. k6 ran in a container on the same host as the Node tracking process, ElasticMQ, analytics worker, and a temporary ClickHouse container.
- **Provider:** no email provider was used; generated signed pixel requests drove the tracking and ClickHouse path.
- **Duration and load:** constant arrival rate of 1,000 open requests per second for 60 seconds. k6 reported 60,001 requests, 999.995 requests per second, 0 failed requests, 0 dropped iterations, and HTTP p95 1.31 ms.
- **Pipeline result after drain:** tracking accepted 60,001 events, dropped 0, and had 0 buffered. ClickHouse contained 60,001 raw events; TrackQ depth was 0. The analytics worker's cumulative error counter was 17 from startup before the missing local TrackQ was created, prior to the load run.
- **Limit:** This verifies the local Phase 5 path at the requested request rate. It does not establish capacity on the planned 2 vCPU / 12 GB demo VM, nor does it test click redirects at that rate.
