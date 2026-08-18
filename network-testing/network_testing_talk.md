# Network Testing at Fleet Scale
### iperf_orchestrator · matrix_orchestrator (mx) · netmesh — with binnacle's `reachable` keeping the list honest

Slides are separated by `---`. Each slide has bullet content plus **Notes:** (what to say).

---

## Part 0 — Overview

---

### Slide: Network testing with these tools

- Three questions about a fleet's network, three tools:
  - **netmesh** (binnacle) — *what does the network do when idle?* RTT, jitter, loss, path MTU.
  - **iperf_orchestrator** — *how much TCP bandwidth under load?* Full-mesh iperf2 throughput sweep.
  - **matrix_orchestrator (`mx`)** — *how many packets per second, when every packet must be answered?* Request/response UDP matrix.
- One family: same `servers.txt` grammar, same ssh-only model, N×N grid outputs that read the same way.
- Plus **`reachable`** (binnacle): prunes dead entries from the server list so the run survives the servers that are down.

**Notes:** Frame the talk: "is the network the problem?" answered at fleet scale over plain ssh. The three tools measure different layers of the same fabric; reachable is the hygiene step that makes any of them reliable on a real, decaying host list.

---

### Slide: Why these tools

- **No agents, no daemons, no root** — plain Python/bash + ssh; nothing installed on servers.
- **Leave no trace** — one remote directory; `clean` verifies it's actually gone before claiming success.
- **Honest numbers** — blank means "not measured", never zero; DELIVERED (receiver-counted) outranks what was sent; causes outrank symptoms.
- **One self-contained file each** — scp-able, stdlib-only; run from a checkout or `pip install`.
- **Built for fleets** — capped parallel ssh fan-out, balanced load assignment, batched collection; patterns proven at N=100+.
- **They compose** — shared list grammar; prune with `reachable`, baseline with `netmesh`, then load.

**Notes:** The alternative is a week of hand-run iperf, ad-hoc pssh loops, and numbers nobody trusts. The design rules (droppable onto any prod host, honest accounting, composability) run through all of them.

---

### Slide: The differences — what each is measuring

| Tool | Traffic | Headline number | Network state | Footprint |
|---|---|---|---|---|
| netmesh | UDP echo probes (agents both ends) | RTT p50/p99, jitter, loss split by leg, path MTU | **Idle** — the baseline | ~10 pkts/s/pair; safe during incidents |
| iperf_orchestrator | TCP full-duplex (iperf2) | Mbps per direction per pair, + peak CPU | **Saturated** | Line-rate flood; schedule a window |
| matrix_orchestrator | UDP request/response, paced | pps + Gbps wire, loss split, true RTT | **Loaded at the rate you choose** | Tunable, gentle → torture |

**Notes:** Different layers fail independently: a fabric can carry 100 Gbit of bulk TCP and still collapse at 2 Mpps of answered packets. A 9.4 Gbit/s result at 300 µs idle RTT and one at 42 ms are *different results* — you need more than one of these numbers to know which you have.

---

### Slide: When to use which

- **reachable** — before *any* fan-out, every time: prune the list so the run measures the fleet, not the list.
- **netmesh** — "is it the network at all, and which link?" Incidents, new fabrics, before blaming anything. Prod-safe.
- **iperf_orchestrator** — fabric acceptance & stress: "will it carry line rate? what breaks under full load?"
- **mx** — RPC-shaped capacity: "how many answered packets/sec?" Small packets at rate is where fabrics and NICs actually fall over.
- Commissioning a new fabric, run them in order: `reachable → netmesh → iperf_orchestrator → mx → netmesh under load`.

**Notes:** Each tool's output tells you whether the next one's numbers make sense.

---

### Slide: `reachable` — the run that survives dead servers

- Server lists rot: decommissioned, renamed, rebuilt without your key. A fan-out that silently skips 11 of 200 hosts looks identical to one that had nothing to say about them.
- `reachable prod.txt -i` pings + ssh's every entry and **comments out failures with the reason and date**; every other tool still reads the file.
- **ssh is the gate, ping is the explanation** — a host answering ssh is kept even with ICMP blocked. Outcomes distinguished: `auth` / `refused` / `dns` / `no-route` / `timeout` / `down`.
- Re-runs **uncomment hosts that come back** — the list converges instead of decaying; your own comments are never touched; safe on cron (exit 0/1/2).
- Ranges (`node[01-24]`) expand; a mixed range is split so failures comment out individually.
- Belt and braces: the orchestrators also **fail open** — per-host failures are tracked and reported, and iperf_orchestrator's `--keep-going` finishes the fleet past a bad host.

**Notes:** This is the resilience story: prune first, and the tools tolerate whatever died since. `reachable prod.txt -i` before every big run.

---

## Part 1 — iperf_orchestrator

---

### Slide: What it is

- A single self-contained bash script (with embedded Python) that runs a **full-mesh iperf2 throughput test** across a server list.
- Samples per-host CPU during the run; parses everything into `iperf_results.csv`, `cpu_summary.csv`, `iperf_pivot.txt`, `iperf_heatmap.png`.
- Built for **fabric stress testing**: load every link in both directions simultaneously, find what breaks or degrades. Also a one-off "is the network healthy" fleet survey.
- Stateless: each run gets a timestamped `results/<run-id>/`; `results/latest` follows the newest.
- `pip install iperf-orchestrator` (or run the script straight from a checkout).

**Notes:** One command in (`iperf-orchestrator --servers servers.txt all`), four artifacts out; the heatmap is the one you open first.

---

### Slide: What is iperf?

- The standard throughput tool: a client opens a TCP connection to a server and pushes bytes as fast as it can for N seconds; the report is the achieved end-to-end bandwidth.
- iperf2 and iperf3 are **different codebases**, not versions of each other.
- The orchestrator uses iperf2's `--full-duplex`: both directions concurrently on a single TCP socket — one test per pair, and closer to what real traffic does to switch buffers.

**Notes:** Quick grounding for anyone who hasn't used it. Set up the iperf2-vs-iperf3 story here.

---

### Slide: Why iperf2, not iperf3 (and why the orchestrator was necessary)

- iperf3's server is **single-threaded, one client at a time** — in a mesh, everyone else gets "server busy". Workaround at N=100: 100 daemons × 100 ports × 100× firewall holes per host. The first version used iperf3 and collapsed under its own workarounds.
- iperf2's multi-threaded server takes concurrent clients on **one port (5001)** — one daemon per host, done.
- Why an orchestrator at all — a mesh has quadratic moving parts:
  - **4,950 pairs at N=100** — nobody runs that by hand.
  - **Synchronized start**: compute `now + 30 s` once, push the epoch, every host busy-waits and fires within a fraction of a second. No locks, no protocol — just a number.
  - **Balanced client assignment (parity rule)**: for pair {i, j}, client = smaller index if i+j even, larger if odd → every host runs 49–50 clients instead of 0–99. Both ends compute it independently.
  - **Tar-batched collection**: one tar + scp + untar per host ≈ minutes, vs ~80 minutes of N² scp handshakes.
  - **CPU sampled on every host** during the run — because a throughput number without CPU next to it gets misread.

**Notes:** Each of these was a real problem hit and fixed; the tool is the accumulated answers. Mention `check-iperf` catches distros where `iperf` is secretly a symlink to iperf3 (`WRONG_VERSION`).

---

### Slide: Why run it — and what it does / doesn't do

- **Why:** acceptance-test a new fabric or change window (load everything, see what breaks); rank slow hosts/links; get a defensible baseline picture of the fleet.
- **Does:** full-duplex TCP mesh; synchronized start; balanced pairs; per-host CPU (mpstat, `/proc/stat` fallback); parse → CSV/pivot/heatmap re-runnable per run-id; capped ssh fan-out (`--jobs`), optional `--retries`; **fails open** — one bad host doesn't abort a 100-host run.
- **Doesn't:**
  - No UDP, no latency, no packet rate — that's netmesh/mx territory.
  - Doesn't install iperf2 or distribute ssh keys — `doctor` / `check-iperf` verify, you provision.
  - No normalization for mixed NIC speeds (1G hosts look red next to 10G).
  - Heatmap past ~60 hosts drops cell labels by design; read the CSV for exact values.
  - `sequential-pair` at N=100 ≈ 14 hours — the cleanest mode is priced accordingly.

---

### Slide: Setup needs

- **Orchestrator host:** bash 4+, ssh/scp, tar/gzip, Python 3.6+ (numpy + matplotlib only for the heatmap step).
- **Every server:** iperf2 (binary named `iperf`, 2.0.13+ for `--full-duplex`); sysstat's `mpstat` recommended; key-based ssh from the orchestrator (BatchMode — a password prompt is a failure, not a prompt).
- Keys first: `for h in $(grep -v '^#' servers.txt); do ssh-copy-id "$h"; done`
- Preflight: `doctor` (local deps + install hints), `check-iperf` (fleet), `check-servers` (what's already running).

---

### Slide: Running, collecting, interpreting, cleaning up

- Pipeline: `start-servers → run-tests → collect-results → parse-csv / parse-cpu / make-pivot / make-heatmap → stop-servers → cleanup --yes`
- `all` runs the whole thing; every stage is a standalone subcommand, safe to re-run (`--run-id` addresses old runs; `results/latest` symlink).
- **Interpreting:** start with `iperf_heatmap.png` and `results-summary` (P50/P95/min/mean/max + 5 slowest pairs).
  - Rows = sender, columns = receiver. **All-red row → that host's outbound is sick; all-red column → sick inbound.** Bar chart ranks hosts by mean outgoing Mbps, with peak CPU% on each bar.
  - **The classic misread:** slow host + `peak_total_pct` ≈ 100% ⇒ you measured the CPU, not the fabric. Second classic: box-wide CPU 30% but softirq pinned at 100% on core 0 ⇒ RSS isn't spreading NIC IRQs — invisible without per-core data (`mpstat -P ALL`).
- **Cleanup:** `stop-servers` kills daemons; `cleanup --yes` removes the remote dir — scoped to the run-id, so parallel runs on a shared FS never collide. Died halfway? `all --resume`; flaky host? `all --keep-going`.

---

### Slide: Different ways to run

- One-liner: `iperf-orchestrator --servers servers.txt all` — everything else is refinement.
- Every setting is both a flag and an env var (`--duration 60` ≡ `IPERF_DURATION=60`); flags win.
- Scale: `--jobs 64` (ssh fan-out cap, setup/teardown only), `--retries N` (linear back-off), `-P` parallel streams, rolling's `--total-time` / `--flows`.
- Trust: `--dry-run` prints every ssh/scp command; `--verbose` / `--quiet`; `status` probes hosts live.
- Fit: `--run-id` for history; `REMOTE_DIR` safe on shared filesystems (files embed host + run-id); no hidden state anywhere.

---

### Slide: Run modes — what they are, when to use them, why they exist

| Mode | Concurrency | Wall-clock @ N=100, 10 s tests | Use it when |
|---|---|---|---|
| `parallel` (default) | every host fires all clients after one synchronized start | ~50 s | **Stress**: load the whole fabric at once, see what breaks |
| `sequential-host` | one host at a time runs all its clients | ~17 min | Clean per-host numbers without inter-host interference |
| `sequential-pair` | exactly one connection on the wire | ~14 h | Cleanest per-pair numbers — usually overkill |
| `rolling` | each host keeps testing its least-tested peer, ≤ `--flows` at once, for `--total-time` | bounded by `--total-time` | **Very large N**: per-host load constant regardless of fleet size |

- **Why modes exist:** one knob — how much traffic shares the wire at once — trades realism vs isolation vs wall-clock. `parallel` answers "what breaks under load?"; sequential modes answer "what is each host/pair capable of?"; `rolling` exists because at huge N even the full-mesh schedule itself becomes the problem.

**Notes:** Pick by question: stress = parallel, capability = sequential-host, forensic = sequential-pair, huge fleet = rolling.

---

## Part 2 — matrix_orchestrator (`mx`)

---

### Slide: Purpose — beyond iperf_orchestrator

- iperf_orchestrator gives each pair's **max TCP bandwidth**. Real traffic isn't bulk bytes — it's RPCs, storage reads, control planes: small requests, sized answers, measured in **packets**.
- `mx` runs that shape: every host sends *x*-byte requests at a target rate to every peer; every request gets a *y*-byte reply. That's the whole model.
- Headline: **packets per second the fleet can exchange when every packet must be answered** — where fabrics and NICs actually fall over.
- **RTT falls out free**: the reply carries the request's timestamp back → true round trip, no clock sync.
- Asymmetry by design: `--tx-size 128 --rx-size 8192` = RPC — equal pps both ways, 64× the bandwidth on the reply path. That asymmetry usually breaks first; the report keeps directions separate.
- **Why UDP only:** "every x-byte request gets a y-byte reply" is a statement about packets; TCP would coalesce and re-segment → the pps number would be fiction. TCP goodput → iperf_orchestrator.

---

### Slide: What it does / doesn't do

- **Does:** paced request/response matrix (rates, sizes, port all in one editable CSV); payload *and* wire rate (+66 B framing/packet — what the NIC actually carries); loss split forward/return; DELIVERED as the honest headline; RTT avg/p50/p99/max per flow; per-host CPU incl. the agent's own share; grids; `check`/`hints`/`doctor` preflight; fd soft-limits raised automatically.
- **Doesn't / limits:**
  - No TCP; no one-way delay (needs clock sync it refuses to pretend it has).
  - Not a kernel-bypass blaster: ~**200k pps per worker** (one core), 1–4 Mpps per typical host; beyond a few Mpps the kernel UDP path is the wall as much as Python — wider fleet or AF_XDP/DPDK.
  - Payload 32–65507 bytes; key-based ssh assumed (`mx doctor` checks).
  - Won't hide its own limits: when a worker saturates, the summary **says you're measuring the tool** and names the fix.

---

### Slide: How to run it — different from iperf_orchestrator

```
printf '%s\n' 10.0.0.10 10.0.0.11 10.0.0.12 > servers.txt
mx gen --servers servers.txt --pps 20000   # 1. build matrix.csv
mx start                                   # 2. deploy + run everywhere
mx status                                  # 3. running? how fast?
mx summarize                               # 4. pps / Gbps / loss / latency
mx stop                                    # 5. stop the agents
mx clean                                   # 6. leave no trace
# or all of it: mx run --for 60
```

- Differences from iperf_orchestrator: servers need **nothing but Python 3.6+** (no iperf2 to install); config lives in `matrix.csv`, not flags you re-type; pure-Python single file, stdlib only.
- Five more when needed: `run`, `check` (will the NICs carry this?), `hints` (goal → command), `logs`, `doctor`.
- Every fleet command: `--user --jobs --remote-dir --python --dry-run` (+ `MX_*` env vars).

---

### Slide: The matrix file — and changing the run mid-stream

```
# mx matrix v1 -- rows send, columns receive, cells are packets/sec
# tx_size=64 rx_size=512 port=5300
src\dst,10.0.0.10,10.0.0.11,10.0.0.12
10.0.0.10,,20000,20000
10.0.0.11,5000,,max
10.0.0.12,20000,20000,
```

- Everything about the traffic lives here; no command needs the flags again. Host tokens: `name[=addr[:port]]`.
- **Mid-stream = edit + `mx start` again** (agents redeploy in seconds):
  - blank a cell → that flow is gone
  - change a cell → that pair gets its own rate
  - write `max` → that pair runs unpaced
  - edit the header → reshape sizes / port
- Non-uniform investigations ("only cross-rack pairs", "one hot pair unpaced") are text edits, not new features.

---

### Slide: Getting results

- `mx status --watch 5` — live ticker, one line per host.
- `mx summarize` — fleet totals, per-host table (worst delivery first), worst flows, and a computed **WHAT TO DO NEXT**.
- `mx summarize --grid g` — N×N CSVs in the matrix's shape: `pps`, `delivered`, `loss`, `rtt_p99`. **Dark row = sick sender; dark column = sick receiver; dark block = congested pair of leaves.**
- `reports/<host>.csv` — one row per flow per interval (pps, loss, RTT percentiles, CPU, workers). Plain CSV; plot with anything.
- `mx logs` for the agents' own logs. Reports survive `mx stop`; only `mx clean` removes them.

---

### Slide: Interpreting the summary

```
REQUESTS   2.640 Mpps   2.75 Gbps wire
DELIVERED  2.601 Mpps   98.52% of what was sent
REPLIES    2.598 Mpps   2.71 Gbps wire
TARGET     2.640 Mpps   100.0% achieved
LOSS       1.59% round trip (1.48% forward, 0.11% back)
RTT        avg 240us; worst flow p50 190us p99 4.1ms max 31ms
```

- **DELIVERED is the honest number** — senders can't see their own drops.
- **Loss split by leg** — dropping 64 B requests vs dropping 8 KB replies need different fixes.
- **RTT is a true round trip** — the stamp comes back; no clock sync involved.
- Per-host CPU columns: `cpu` (box) / `1 core` (busiest core) / **`agent`** (busiest worker as share of one core). **`agent` ≈ 100% ⇒ you're measuring the tool, not the network** — add workers (spare cores) or hosts; the summary says so in as many words.
- Performance model: ~200k pps × workers × hosts. Processes, not threads (GIL: 4 threads = 57k pps; 4 processes = 1.09M). One core pegged while the box idles? Workers can't outnumber flows → `--streams N` gives each pair N sockets (rate **split**, not multiplied) so workers/RSS/ECMP have tuples to spread: `mx start --streams 8 --workers 32`.

---

### Slide: Finding the limit — and common options

- `mx check --nic-gbps 25 --nic-mpps 15` first — was what you asked for even possible?
- Ramp: `--pps 50000` → run → `--pps 100000` → … The last rate that delivers cleanly is the fleet's sustainable all-to-all packet rate.
- Watch **in order**: (1) p99 lifting off the p50 — queues filling, usually before loss; (2) DELIVERED falling behind REQUESTS — something's dropping.
- `--pps max` = unpaced: finds the ceiling fastest, tells you less about where it is.
- Common shapes: `--tx-size 64 --rx-size 64 --pps max` (small-packet torture) · `--tx-size 128 --rx-size 8192` (RPC) · `--gbps 10 --tx-size 1400` (bandwidth-budget sizing) · `mx start --bind eth1` (data-NIC pinning — retargets peers' addresses too, both halves of the two-NIC job).

---

### Slide: Ways to run at different scales — getting the best run

- **Small fleet (≤ ~30): full mesh** (default `gen`). Every pair, continuously — the forensic shape. Big box, few peers? add `--streams`.
- **Large fleet: `--peers K`** — k-regular shuffle: each host talks to exactly K shuffled peers. Equal per-host load **by construction** (K superimposed permutations), K sockets instead of N−1, seeded + replayable (`--seed`). `--streams S` multiplies 4-tuples for ECMP coverage; a host holds K×S sockets.
- **Full pair coverage at huge N: `--peers K --dwell T`** — layered rotation: the N−1 shifts of the shuffle are dealt out K at a time into ⌈(N−1)/K⌉ edge-disjoint layers; agents switch layers on their own wall clock (no control channel). After one cycle **every ordered pair measured exactly once**; per-host load never changes. 1000 hosts: full coverage every ~6 min on 8 sockets (`--dwell 3 --interval 1`). `--equal-layers` for dip-free soaks; COVERAGE section + `coverage_grid.csv` report progress.
- Dwell floor: whole multiple of `--interval`; useful floor ≈ 3× interval.
- Don't want to remember this? **`mx hints --servers s.txt --pps-per-host N`** does the arithmetic and prints the command.

---

### Slide: Stopping and cleaning up

- Everything on a server lives in one directory (`/var/tmp/mx`; `--remote-dir` to change): agent, matrix, log, report. No package, no sysctl, no unit file.
- `mx stop` — agents halt; **reports and logs stay** for later collection.
- Take `mx logs` and `mx summarize` first — then `mx clean`.
- `mx clean` **refuses to report success** unless the directory is verifiably gone and no agent still runs.
- Agents flush the current interval on SIGTERM — stopping doesn't discard the last seconds of data.

---

## Part 3 — netmesh

---

### Slide: What it is, and how it fits the grouping

- One of binnacle's eight diagnostic tools (`pip install binnacle`); its question: **"is it the network, and which link is sick?"**
- Measures RTT, jitter, loss and path MTU between machines **when nothing else is running** — the idle baseline.
- The gap it fills: iperf_orchestrator = bandwidth under load; mx = pps under load. **Neither says what the network does idle — and that's the baseline both numbers must be read against.**
- Deliberately the cheapest of the three: ~10 small packets/s per pair — safe on production during an incident.
- Two hosts and one line is the design centre; mesh files, grids and layered scale-up exist but a two-box user never sees them.
- Why run it: before blaming the network in an incident; before commissioning load tests; as a recurring health probe; and around a load test (`--baseline`) to see what the load does to latency.

---

### Slide: How it probes (why not ping)

- **UDP echoes between temporary agents** — the only approach giving all four:
  - **No root** — ordinary unprivileged UDP sockets both ends.
  - **Exact RTT, one clock** — sender's own monotonic stamp echoed back untouched; no NTP assumptions.
  - **Loss split into forward/return legs** — the responder independently counts what arrived. Not available from ping.
  - **Measures the data plane** — ICMP is answered by router control planes (rate-limited, deprioritized), so it systematically lies about what application traffic sees.
- **One-way delay deliberately not reported** — without PTP the clock offset would swamp the microseconds that matter. Instead: two separate round trips (A→B timed by A, B→A timed by B), compared — every number quoted is one that is actually true.
- Can't deploy an agent (VIP, router, appliance)? Prefix with `~` → probed with ping, but **segregated as ONE-SIDED** in the report because those rows carry materially less.

---

### Slide: How to run it

```
netmesh selftest                        # prove it works here first (loopback, no ssh)
netmesh check web01 db01                # one-shot: gen, deploy, probe, summarize, clean
netmesh check web01 db01 --for 60
netmesh gen --servers prod.txt          # mesh file for repeat runs
netmesh run --for 300 --grid grids/
netmesh check web03 db01 --flows 8      # sweep source ports across a LAG/ECMP bundle
netmesh run --baseline 20 -- ./iperf_orchestrator.sh all   # idle first, then probe under load
```

- Same verb set as mx (`gen/start/status/summarize/stop/clean` + `run/collect/logs/paths/doctor`); the mesh file shares mx's matrix grammar — learn one, know the other.
- **`--flows N` matters:** one source port = one 5-tuple = one path through a LAG/ECMP bundle — a sick member is hit or missed by luck (the fault that never reproduces). N buckets split the rate (never multiply it) and are compared against the **median** bucket: "port 40008 sees p50 4.1 ms where the median flow sees 142 µs — same pair, same instant, so what differs is the bundle member."
- IPv6: refused by netmesh (the rest of binnacle's list grammar supports it).

---

### Slide: Getting reports & interpreting

- `reports/<host>.csv` — tidy long format, one row per peer per direction per interval. **Blank means "not measured", never zero.** `--grid DIR` writes `rtt_p50/rtt_p99/jitter/loss/mtu/asym` grids matching mx's layout.
- Headline = **median of pair p50s** (one sick pair can't move it or hide inside it); worst pairs ranked by p99.
- **ASYMMETRY** — A→B 8× slower than B→A ⇒ look at A's egress; the return path just proved itself fine. Diagnosis is computed, not canned: slow pairs sharing a source → that host's egress; sharing a destination → its ingress; spanning a group boundary → the path between.
- **PATH MTU** — four outcomes: confirmed / **blackhole** (small packets echo, large vanish, no error returns — "small requests work, large transfers hang") / cached / unsupported. Found without root; only an end-to-end echo counts.
- **PATH SPREAD** (`--flows`) — one bucket 28.9× the median = a sick LAG/ECMP member, named while the run is fresh.
- **UNDER LOAD** (`--baseline`) — p99 210 µs idle → 42 ms loaded: the queue in front of the bottleneck; what everything sharing the path paid for the throughput number. Loss appearing only under load gets its own finding.
- Measurement honesty: flags when a NIC's `rx-usecs` coalescing timer is the floor you measured (with the `ethtool` line); `agent_cpu_pct` ≈ 100 ⇒ you're measuring the tool.
- **A clean run says so plainly** — "the network is not your problem" — and points at mx / iperf_orchestrator for the load question.

---

### Slide: Stopping, cleaning up, following up

- `check` cleans up after itself — the two-host case never leaves anything behind. Managed runs: `stop` keeps reports; `clean` stops and removes every trace. No package, no daemon, no dotdir, no sysctl — ever. Agents flush on SIGTERM.
- Reports replay: `summarize --reports ./reports`, even re-split around a load window after the fact (`--load-split <ts>`).
- **Following up on findings:**
  - Sick pair → `netmesh paths --compare web03:db01 web01:db01` — hop lists side by side, **first divergent hop marked**. That hop is where to look.
  - Grids drop into the same spreadsheet as mx's — line up idle RTT against loaded loss, pair by pair.
  - Clean baseline → the network isn't the problem: go load it (`mx run --for 60`, `iperf-orchestrator all`).
  - Host still slow → binnacle's `why-slow` checks the box before you blame the network again.

---

## Close

---

### Slide: Putting it together

```
reachable prod.txt -i                       # prune -- the run survives the dead
netmesh check ...                           # idle baseline: is the fabric healthy?
iperf-orchestrator --servers prod.txt all   # TCP bandwidth: what breaks under load?
mx run --for 300                            # answered packets/sec: the RPC ceiling
netmesh run --baseline 20 -- <load>         # what the load did to latency
```

- **Baseline before load** — a throughput number without its idle RTT is half a result.
- **Trust what arrived, not what was sent** — and watch the CPU, or you're measuring the tool.
- **Keep the list real** — `reachable` is why the whole pipeline still runs when servers are down.
- All pip-installable: `iperf-orchestrator`, `matrix-orchestrator`, `binnacle`.

