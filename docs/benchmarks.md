# Measured benchmarks

## Phase 5 open-event ingestion — 2026-11-12

- **Command:** `docker run --rm --env-file /tmp/vichaar-phase5-k6.env -v /Users/saksham/PROJECTS/Vichaar/loadtests/events.js:/loadtest.js:ro grafana/k6:latest run /loadtest.js`. The env file contained a signed open token and `TRACKING_BASE_URL=http://host.docker.internal:4001`; no token value is recorded here.
- **Hardware:** Mac17,3, 10 logical CPUs, 16 GiB host RAM. Docker resource allocation was not measured. k6 ran in a container on the same host as the Node tracking process, ElasticMQ, analytics worker, and a temporary ClickHouse container.
- **Provider:** no email provider was used; generated signed pixel requests drove the tracking and ClickHouse path.
- **Duration and load:** constant arrival rate of 1,000 open requests per second for 60 seconds. k6 reported 60,001 requests, 999.995 requests per second, 0 failed requests, 0 dropped iterations, and HTTP p95 1.31 ms.
- **Pipeline result after drain:** tracking accepted 60,001 events, dropped 0, and had 0 buffered. ClickHouse contained 60,001 raw events; TrackQ depth was 0. The analytics worker's cumulative error counter was 17 from startup before the missing local TrackQ was created, prior to the load run.
- **Limit:** This verifies the local Phase 5 path at the requested request rate. It does not establish capacity on the planned 2 vCPU / 12 GB demo VM, nor does it test click redirects at that rate.
