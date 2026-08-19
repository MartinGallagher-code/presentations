# Network Testing at Fleet Scale
### iperf_orchestrator · matrix_orchestrator · netmesh

Slides are separated by `---`. Each slide has bullet content plus **Notes:** (what to say).

---

### Slide: Three questions, three tools

Testing a fleet's network really means answering three different questions — each tool here answers one of them.

| Tool | The question it answers | Network state | Cost to run |
|---|---|---|---|
| netmesh | Is the network healthy, and which link is sick? — RTT, jitter, loss, path MTU | **Idle** — the baseline | ~10 small pkts/s per pair; safe on production |
| iperf_orchestrator | How much TCP bandwidth can every link carry, all at once? | **Fully loaded** | Line-rate flood — schedule a window |
| matrix_orchestrator (mx) | How many packets/sec can the fleet exchange, when every packet is answered? | **Loaded at the rate you choose** | Tunable, gentle → torture |

They're one family: the same servers.txt, the same ssh-only model, and grids that read the same way. And they measure different layers of the same fabric — a 9.4 Gbit/s result over a 300 µs path and one over a 42 ms path are *different results*.

**Notes:** The frame for the whole talk. Bandwidth, packet rate and latency fail independently, so no single tool can tell you the network is fine. netmesh is cheap enough to run during an incident; iperf_orchestrator is the scheduled stress test; mx is the request/response rate test that looks like real RPC and storage traffic. Because they share one host-list grammar and one deployment model, learning one means you know how to drive all three.

---

### Slide: Why these tools

- **They go anywhere you can ssh.** No agents, no daemons, no root — nothing installed on the servers, and `clean` removes every trace afterwards.
- **The numbers are honest.** Blank never means zero, and the headline is what the *receiver* counted — not what the sender hoped. When a tool becomes its own bottleneck, it says so.
- **They're one file each.** Stdlib-only Python — `pip install` it, or just scp the file and run it.
- **Each stands alone.** Pick whichever answers today's question — no setup or ordering ties them together. They do share the same server-list format and the same verbs, so learning one means you can drive them all.

**Notes:** The alternative is a week of hand-run iperf, ad-hoc pssh loops, and numbers nobody trusts. Each tool is complete on its own — grab the one that matches the question in front of you. The shared conventions are a convenience, not a dependency: one servers.txt works everywhere, and the gen / start / status / summarize / stop / clean verbs mean the muscle memory transfers.

---

### Slide: reachable — the run survives dead servers

- Server lists rot — and a fan-out that silently skips eleven dead hosts looks exactly like one that ran everywhere.
- `reachable prod.txt -i` pings and ssh's every entry and comments out the failures, with the reason and date. When a host comes back, the next run uncomments it — and your own comments are never touched, so it's safe on cron.
- **ssh is the gate, ping is the explanation**: a host that answers ssh is kept even when ICMP is blocked.

```
web01
# db07   #[unreachable] pings but ssh does not answer - 2026-08-15
# ghost  #[unreachable] name does not resolve - 2026-08-15
noicmp   # ICMP blocked here by policy   <- kept: ssh works
```

- Belt and braces: the orchestrators also fail open (`--keep-going`), so one dead box never aborts a 100-host run.

**Notes:** This answers "can the test still run when several servers are down?" — twice over. First, prune: reachable keeps the list true, distinguishes a key problem from a dead box (auth / refused / dns / no-route / timeout / down), and converges instead of decaying. Second, the tools themselves tolerate failures mid-run: per-host failures are reported and skipped, not fatal. reachable prod.txt -i before every big run is the habit to sell.

---

## Part 1 — iperf_orchestrator

---

### Slide: What it is — and why you'd run it

- Takes **iperf** — the standard tool for measuring how fast the network really is between two machines — and runs it between **every pair of servers in a fleet, at the same time**.
- The point is to load the network as *efficiently as possible*: every link, both directions, simultaneously. Ten seconds of that answers the real question — **what can this fabric actually carry, and what breaks first?**
- Why run it: accept a new fabric or a change window; find the slow links and slow hosts; get a quick "is the fleet's network healthy?" picture.
- One command in → four artifacts out: results CSV · per-host CPU summary · pivot table · **heatmap**.
- One self-contained script, driving everything over ssh — the servers need nothing but iperf itself. A dead host is reported and skipped, never fatal.
- What it leaves to its siblings: latency and packet rate (that's netmesh and mx).

**Notes:** Lead with the goal, not the implementation: a mesh of N hosts has N·(N−1)/2 pairs, and the only way to truly max out a fabric in a short window is to orchestrate all of them at once — that's the tool's whole reason to exist. Mention only in passing that it happens to be a single script; what matters is that servers need zero setup beyond iperf and an ssh key.

---

### Slide: What is iperf?

iperf is the de-facto standard throughput tool: one box plays **server**, another plays **client**, and the client pushes bytes over TCP as hard as it can for a fixed time. The achieved rate is the answer — the true end-to-end capacity of that path: NICs, kernel, cables, switches, everything in between.

| Concept | What it means |
|---|---|
| server / client | `iperf -s` waits on the server; `iperf -c <server>` connects and sends |
| duration (`-t`) | how long the push lasts — 10 s default; longer smooths out bursts |
| parallel streams (`-P`) | several TCP connections at once — one stream often can't fill a fat pipe |
| full-duplex | both directions on the same connection at the same time — like real traffic |
| TCP vs UDP | TCP measures achievable throughput; UDP sends a fixed rate to measure loss/jitter |
| the report | bytes moved and bandwidth, per interval and in total |

Given enough CPU, iperf will saturate a 1G / 10G / 25G link — exactly what a stress test needs. But it thinks in **pairs**: it has no idea a fleet exists. That's the orchestrator's job.

**Notes:** Take a beat here for anyone who hasn't used iperf. The mental model: it answers "how fast is the pipe between A and B, really?" by filling it. Emphasize that the number includes the whole path — a slow result can be the NIC, the host's CPU, or the network, which is exactly why the orchestrator also samples CPU. The pair-at-a-time limitation is the segue to the next slide.

---

### Slide: Why iperf2 — and why an orchestrator at all

- Two iperfs exist. **iperf3**'s server takes one client at a time — in a mesh, everyone else gets "server busy". At 100 hosts the workaround is 100 daemons × 100 ports per host. **iperf2** takes concurrent clients on one port, and its `--full-duplex` tests both directions on one connection. (The first version used iperf3; the architecture collapsed under its own workarounds.)
- A mesh has quadratic moving parts — **4,950 pairs at N=100** — and making it efficient is the orchestrator's job:
  - **Everyone starts together**: one "start at" timestamp is pushed out; every host waits for it and fires within a fraction of a second.
  - **The work is spread fairly**: a parity rule on host positions gives every host ~half the client jobs (49–50 each at N=100, instead of one host running 99).
  - **Results come home fast**: one archive per host instead of thousands of copies — minutes, not the ~80 minutes it once took.
  - **CPU is sampled everywhere** during the run, because a throughput number without CPU next to it gets misread.

**Notes:** Each of these was a real problem hit and fixed — the tool is the accumulated answers. Worth a warning: some distros ship "iperf" as a symlink to iperf3; the check-iperf preflight catches that (WRONG_VERSION). The parity rule detail if asked: for pair {i, j}, the client is the smaller index when i+j is even, the larger when odd — both ends compute it independently, so no coordination is needed.

---

### Slide: Running it, start to finish

```
iperf-orchestrator --servers servers.txt all
```

=> start-servers | iperf comes up everywhere -> run-tests | the synchronized mesh -> collect-results | logs come home -> process | CSV, pivot, heatmap -> stop + cleanup | leave no trace

- Every run lands in its own timestamped folder — `results/<run-id>/`, with `results/latest` pointing at the newest. Old runs can be re-analyzed any time (`--run-id`).
- **Reading a run, in order:** ① the heatmap — a red *row* means that server sends slowly to everyone; a red *column* means everyone struggles to reach it. ② the CPU summary — if a "slow" host's CPU was pegged, you measured the host, not the network. ③ `results-summary` — percentiles plus the five slowest pairs.
- Useful switches: `--dry-run` (show what would run, run nothing) · `--keep-going` (finish past a dead host) · `--resume` (pick up an aborted run) · `--duration` / `-P` (longer or multi-stream tests). Every switch is also an environment variable.

**Notes:** Keep this non-specialist: one command does the whole pipeline, and each box in the flow is also a standalone subcommand for day-2 work — re-render a heatmap, re-collect from one host, re-run just the analysis. The reading order matters more than any switch: heatmap for *where*, CPU for *whether to believe it*, summary for *how bad*. Narration extras if asked: collection is batched one archive per host, and the remote directory is safe on shared filesystems because every file embeds host + run-id.

---

### Slide: The four run modes

Every run answers "how fast?" — the **mode** decides *how much traffic shares the wire at once*. That one choice trades realism against isolation against wall-clock time.

| Mode | On the wire at once | @ 100 hosts | In one line |
|---|---|---|---|
| `parallel` (default) | everything | ~1 min | the stress test — load it all, see what breaks |
| `sequential-host` | one host's tests | ~17 min | what is each *server* capable of? |
| `sequential-pair` | one connection | ~14 h | the microscope — cleanest possible pair numbers |
| `rolling` | a few per host, continuously | you choose | fleets too big to mesh; long soaks |

**Notes:** Frame it as one dial, four positions. parallel is realism: everything contends, like a bad day in production. The sequential modes buy isolation with time. rolling gives up the synchronized snapshot entirely in exchange for a constant, gentle load that works at any fleet size. The next four slides take them one at a time.

---

### Slide: parallel — the stress test (default)

- **What happens:** after a synchronized start, every host fires all of its tests at once — the entire fabric is under full bidirectional load within a second.
- **When to use it:** accepting a new fabric, validating a change window, or any time the question is "what breaks under full load?"
- **How:** `iperf-orchestrator --servers servers.txt all` — parallel is the default.
- **Time:** about one test-duration regardless of fleet size (~50 s at N=100).
- **Reading the results:** every pair shares the fabric, so numbers *below* line rate everywhere are normal — what matters is the outliers: dark rows/columns on the heatmap, and hosts whose CPU pegged. This mode finds congestion, oversubscription and weak links; it does **not** give you any single pair's clean maximum.

**Notes:** This is the mode the tool was built for and the one to demo. Set expectations about the numbers: under full contention a 10G host talking to 49 peers won't show 10G to each — you're reading the *distribution* and its outliers, not absolute line rate. If something looks bad here, the next two modes are how you isolate it.

---

### Slide: sequential-host — one server at a time

- **What happens:** each host in turn runs all of its tests in parallel while every other host stays quiet.
- **When to use it:** "what is this *server* capable of?" — clean per-host numbers with no neighbors interfering; the natural follow-up for a host that looked bad under `parallel`.
- **How:** `iperf-orchestrator --servers servers.txt all sequential-host`
- **Time:** ~N × duration (~17 min at N=100).
- **Reading the results:** with the fabric to itself, each host should approach line rate. One that is still slow has a *local* problem — NIC, driver, CPU — not congestion. Compare against the parallel run: fine alone but bad in parallel = contention; bad in both = the host itself.

**Notes:** The parallel/sequential-host comparison is the diagnostic one-two punch: the first finds the suspect, the second tells you whether it's the host or the fabric. This is also the mode for baselining what "good" looks like per host class before a stress run.

---

### Slide: sequential-pair — the microscope

- **What happens:** exactly one connection on the wire at any moment, pair after pair.
- **When to use it:** confirming a single suspect pair with the cleanest number possible — almost never for a whole fleet.
- **How:** `iperf-orchestrator --servers suspects.txt all sequential-pair` — put just the suspect hosts in the list.
- **Time:** N(N−1)/2 × duration. At N=100 that's ~14 hours; at N=4 it's a minute. Priced accordingly.
- **Reading the results:** as clean as pair numbers get — nothing else was running. If a pair is still slow here, the *path itself* is the problem: hand it to `netmesh paths` to find the hop.

**Notes:** The trap to warn about: running sequential-pair across a big fleet because it's "the accurate one". It is — and it's quadratic. The right use is surgical: three or four hosts you already suspect, cleanest numbers in minutes, then escalate to path-level tools if it's still slow.

---

### Slide: rolling — fleets too big to mesh

- **What happens:** no grand schedule. Each host just keeps a couple of short tests running — always against its *least-tested* peer — for as long as you budget.
- **When to use it:** very large fleets, where even the parallel mesh's setup and load become the problem; long soak tests.
- **How:** `iperf-orchestrator --servers servers.txt --total-time 1800 --flows 2 all rolling`
- **Time:** exactly the budget you give it. Per-host load stays constant no matter how big the fleet is.
- **Reading the results:** a survey, not a snapshot — coverage evens out over time because every host picks its least-tested peer. Read the percentiles and the slowest pairs; give it enough time that every pair has been visited a few times.

**Notes:** The contrast to land: parallel is one synchronized photograph of the fleet under maximum load; rolling is a long exposure at gentle, constant load. At 1,000 hosts a full mesh is half a million pairs — rolling is the only shape that stays sane there, and its per-host load being independent of fleet size is the property that makes it safe.

---

### Slide: Tutorial — your first run

```
# 0. install on the machine you'll drive from
#    (servers need only iperf2 + your ssh key)
pip install iperf-orchestrator

# 1. list your servers, one per line
printf '%s\n' 10.0.0.10 10.0.0.11 10.0.0.12 10.0.0.13 > servers.txt

# 2. make key-based ssh work everywhere
for h in $(grep -v '^#' servers.txt); do ssh-copy-id "$h"; done

# 3. preflight: local deps, then iperf2 + mpstat on every host
iperf-orchestrator doctor
iperf-orchestrator --servers servers.txt check-iperf

# 4. the whole pipeline, default (parallel) mode
iperf-orchestrator --servers servers.txt all
```

- You'll watch the five stages run; per-host warnings are printed but don't stop the run. A few minutes later the results directory is announced.

**Notes:** This and the next slide are the take-home reference. If demoing live, four small VMs are plenty. The two preflights catch ninety percent of first-run failures: missing local python packages, iperf secretly being iperf3, mpstat absent, or a host that still wants a password.

---

### Slide: Tutorial — reading it, and running it again

```
ls results/latest/                # iperf_results.csv  cpu_summary.csv
                                  # iperf_pivot.txt    iperf_heatmap.png
iperf-orchestrator results-summary          # P50/P95 + 5 slowest pairs

iperf-orchestrator --duration 30 -P 4 all   # longer tests, 4 streams each
iperf-orchestrator --run-id <id> make-heatmap        # re-render an old run
iperf-orchestrator --servers servers.txt cleanup --yes   # tidy the servers
```

- Open the heatmap first: **rows = sending, columns = receiving.** A red row is a host with bad outbound; a red column, bad inbound.
- Before blaming the network, open `cpu_summary.csv` — a pegged host makes its own links look slow.
- Every run is a timestamped folder: keep them, and diff results across change windows.

**Notes:** The habits to leave the audience with: heatmap → CPU → summary, in that order; bump --duration and -P when a single 10-second stream can't fill the pipe (common on 25G+); and treat run folders as records — the before/after diff across a change window is often the most valuable artifact the tool produces.

---

## Part 2 — matrix_orchestrator (`mx`)

---

### Slide: The question iperf can't answer

- iperf just told us how many **bytes** per second the fabric can move. But most real traffic isn't bulk bytes — it's *conversations*: a small request goes out, an answer comes back. RPCs, storage reads, control planes.
- That traffic stresses a network in **packets per second**, not bits per second — and pps is where fabrics and NICs actually fall over.
- `mx` runs exactly that shape: every host sends small requests at a steady rate to every other host, and **every request gets a reply**.
- Bonus: the reply carries the request's own timestamp back, so you get true **round-trip latency for free** — no clock synchronization anywhere.
- A realistic example: `--tx-size 128 --rx-size 8192` is an RPC — the same packet rate in both directions, but 64× the bytes on the reply path. That asymmetry is usually what breaks first.

**Notes:** Land the contrast with a picture in words: a fabric can move 100 gigabits of bulk TCP happily and still collapse at two million answered packets per second — and your database traffic looks like the second thing, not the first. If asked why UDP: TCP would quietly merge small packets together, so a "packets per second" number over TCP would be fiction. The two tools are two halves of the load story: iperf_orchestrator for bytes, mx for packets.

---

### Slide: What it does — and where it stops

- **Does:** a paced request/response matrix between every pair — rate, sizes and port all in one editable file.
- **Does:** honest accounting — the headline is what the *receivers* counted, and loss is split into the outbound leg and the return leg.
- **Does:** true round-trip percentiles per flow, and it reports its **own CPU cost** right next to the network numbers.
- **Doesn't:** TCP — that's iperf_orchestrator's job.
- **Doesn't:** one-way delay — that would need synchronized clocks nobody has, so it refuses to fake it.
- **Doesn't:** more than a few million packets/sec per host — beyond that you're in kernel-bypass territory. And when the tool itself becomes the limit, **it tells you so** rather than letting you blame the network.

**Notes:** The theme is honesty: receiver-counted delivery, split loss, refusal to report numbers that can't be true, and self-awareness about its own ceiling. That last one matters most in practice — a load generator that silently saturates makes the network look guilty; this one names itself and names the fix (more workers, more streams, or more hosts).

---

### Slide: Six commands drive it

| Command | What it does |
|---|---|
| `mx gen` | build the traffic matrix from your server list |
| `mx start` | copy the agent everywhere and start it |
| `mx status` | one live line per host — running, and how fast? |
| `mx summarize` | collect reports → pps / loss / latency + *what to do next* |
| `mx stop` | stop the agents — reports stay on the hosts |
| `mx clean` | stop, delete every trace, and verify it's gone |

`mx run --for 60` does the whole cycle in one shot. Servers need nothing but Python and your ssh key — no iperf, no packages, no root.

**Notes:** Deliberately simpler than iperf_orchestrator: six verbs and one file. Also worth naming the helpers — mx doctor checks the fleet is ready, mx check asks "can the NICs even carry what you're about to request?", and mx hints turns a goal ("2 million packets per second per host") into the exact command.

---

### Slide: One file describes the traffic — edit it, even mid-run

```
# rows send, columns receive, cells are packets/sec
# tx_size=64 rx_size=512 port=5300
src\dst,10.0.0.10,10.0.0.11,10.0.0.12
10.0.0.10,,20000,20000
10.0.0.11,5000,,max
10.0.0.12,20000,20000,
```

- Everything about the traffic lives in `matrix.csv` — no flags to remember or re-type.
- Want to change a running test? **Edit the file, `mx start` again.** Blank a cell to silence a pair · raise a cell to make a hot pair · write `max` to run one pair unpaced · edit the header to reshape every packet.
- "What if only the cross-rack pairs run?" is a thirty-second text edit, not a feature request.

**Notes:** This is the tool's real interface, and the mid-stream story: investigations are edits. Agents redeploy in seconds and reports keep accumulating, so iterating on the traffic shape mid-session is normal, not exceptional.

---

### Slide: Reading the summary

```
REQUESTS    2.640 Mpps        what the senders put on the wire
DELIVERED   2.601 Mpps        what the receivers actually counted
LOSS        1.59% round trip  (1.48% outbound, 0.11% coming back)
RTT         avg 240us         worst flow p99 4.1ms
```

- **DELIVERED is the headline** — a sender can't see its own drops.
- **Loss is split by direction** — dropping tiny requests and dropping big replies point at different problems.
- The summary ends with **WHAT TO DO NEXT** — it reads its own numbers and names the knob they point at.
- Watch the **agent** CPU column: near 100% means the tool is the bottleneck, not your network — add workers (`--workers`), spread with `--streams`, or add hosts. The summary says this in as many words.
- `mx summarize --grid g` writes N×N grids: a dark **row** is a sick sender, a dark **column** a sick receiver — read exactly like the iperf heatmap.

**Notes:** Rule of thumb for the room: believe what arrived, not what was sent — then check whether the tool itself was working too hard before blaming the fabric. The performance model in one breath: roughly 200k packets/sec per worker process per core, times workers, times hosts; mx hints does that arithmetic for you.

---

### Slide: Finding the fleet's limit

```
mx check --nic-gbps 25            # was what you're asking even possible?
mx gen --servers s.txt --pps 50000  && mx run --for 120
mx gen --servers s.txt --pps 100000 && mx run --for 120
...                               # raise until delivery stops keeping up
```

- The last rate that delivers cleanly **is** the fleet's sustainable packet rate.
- Two warning signs, in the order they appear: ① **p99 latency lifts away from the median** — queues are filling; ② **DELIVERED falls behind REQUESTS** — something is now dropping.
- In a hurry? `--pps max` sends unpaced and finds the ceiling fastest — but tells you less about where the comfortable limit is.

**Notes:** Queues fill before packets drop, so latency is the early warning — that ordering is the one thing to remember from this slide. Run mx check first so you never spend an afternoon discovering you asked a 10G NIC for 25G of replies.

---

### Slide: Big fleets

- Small fleet? The default **full mesh** is perfect — every pair, all the time.
- Big fleet? `--peers 8`: each host talks to exactly **8 shuffled peers** instead of all N−1. Every host still carries identical load, the whole fabric is still exercised — with 8 connections per host instead of hundreds.
- Still need every pair checked? Add `--dwell 60`: the 8 peers **rotate on a schedule** until every pair has been measured — per-host load never changes, and no coordination traffic is needed.
- Don't want to think about any of this? **`mx hints`** — tell it your goal, it prints the command.

**Notes:** The intuition without the math: a random 8-peer assignment already spreads load evenly and crosses every layer of the fabric — the full mesh isn't needed for equal load, only for complete pair coverage, and the rotation buys that back at the same cost. A thousand-host fleet gets every-pair coverage every few minutes on eight sockets per host. The construction is seeded and replayable if anyone asks.

---

### Slide: Tutorial — your first mx run

```
# 0. install on the machine you drive from
#    (servers need only python3 + your ssh key)
pip install matrix-orchestrator

# 1. servers, one per line
printf '%s\n' 10.0.0.10 10.0.0.11 10.0.0.12 > servers.txt

# 2. preflight the fleet: ssh, python, file-descriptor limits
mx doctor

# 3. describe the traffic: every pair, 20k requests/sec
mx gen --servers servers.txt --pps 20000

# 4. sanity-check it against the hardware
mx check --nic-gbps 10

# 5. run for 60 seconds: deploy, run, summarize, stop
mx run --for 60
```

- The summary prints totals, the worst hosts and flows, and what to do next.

**Notes:** Same shape as the iperf_orchestrator tutorial on purpose: list, preflight, one command. For a live demo three small VMs are enough — and mx selftest-style confidence comes from mx doctor plus a tiny --pps first run.

---

### Slide: Tutorial — watching, tuning, cleaning up

```
mx status --watch 5                  # live ticker while it runs
mx summarize                         # anytime -- reports accumulate
mx summarize --grid g                # N x N grids for a spreadsheet

vi matrix.csv && mx start            # change the traffic mid-flight
mx gen --servers servers.txt --pps 50000 && mx run --for 120   # ramp up

mx logs                              # keep the agent logs
mx stop                              # pause -- reports stay on hosts
mx clean                             # done -- delete every trace, verified
```

- `stop` and `clean` are different on purpose: stop keeps the evidence, clean removes it and *proves* it's gone.
- Everything on a server lives in one directory — no packages, no services, nothing to un-install.

**Notes:** The workflow to model: run, summarize, edit the matrix, run again — an investigation loop measured in seconds. Collect logs and summaries before clean; after clean there is genuinely nothing left, which is the point.

---

## Part 3 — netmesh

---

### Slide: The baseline the load tests need

=> netmesh | IDLE: latency · loss · path MTU -> iperf-orchestrator | LOADED: TCP bandwidth -> mx | LOADED: packets per second

- The load tools tell you what the fabric can *carry*. netmesh tells you what the fabric is *like* when nothing is running — and every loaded number has to be read against that baseline.
- It measures **round-trip time, jitter, loss and path MTU** between your machines, using ~10 small packets per second per pair — light enough to run on **production, during an incident**.
- Two hosts and one line is the whole experience: `netmesh check web01 db01`.

**Notes:** The one-sentence pitch: a 9.4 gigabit result over a 300-microsecond path and the same result over a 42-millisecond path are different results — netmesh is how you know which one you have. It's also the tool to reach for first in an incident, because it's the only one of the three that's safe to point at production while users are on it.

---

### Slide: Why not just ping?

- netmesh probes with **small UDP packets between two tiny agents** it places on your hosts — and that buys four things ping can't do:
- **No root, anywhere.** Ordinary sockets, ordinary user.
- **Exact latency.** The sender's own clock stamp comes back in the echo — one clock, so the round trip is exact, no time-sync assumptions.
- **Loss with a direction.** The far end counts what actually arrived — so loss splits into *on the way there* vs *on the way back*. A sick sender and a sick receiver are different findings.
- **The real path.** Routers answer ping with their slow management CPU, which gets rate-limited and deprioritized — ping systematically lies about what your application traffic sees. UDP probes travel the same path your traffic does.
- One-way delay is deliberately **not** reported: without synchronized clocks it would be a made-up number, and this tool doesn't report those.

**Notes:** For endpoints you can't put an agent on — a VIP, a router, an appliance — prefix the host with ~ and it falls back to ping, but those rows are clearly quarantined in the report as one-sided, because they carry less truth. The theme continues: every number quoted is one that is actually true.

---

### Slide: Reading the report

- **The headline** — the median pair's latency, so one sick pair can neither drag the fleet number nor hide inside it. Worst pairs listed underneath.
- **Asymmetry** — A→B slow but B→A fine? Look at A's *sending* side: the return trip just proved the rest of the path is healthy.
- **MTU black hole** — small packets pass, big ones silently vanish: the classic "small requests work, large transfers hang" bug. Found without root.
- **Path spread** — with `--flows`, one traffic stream 29× slower than its siblings = a sick member inside a LAG/ECMP bundle. The fault that "never reproduces", pinned.
- **Under load** — run it around a load test and it shows what the load *did* to latency: p99 210 µs idle → 42 ms loaded is what everyone else on that path paid.
- And a clean run says so in plain words: **"the network is not your problem."**

**Notes:** Every diagnosis is computed from the data, not canned: slow pairs sharing a source point at that host's egress; sharing a destination, its ingress; crossing a rack boundary, the path between. The under-load section is the bridge back to the other two tools — wrap netmesh around an iperf or mx run and the latency cost of the throughput number appears in the same report.

---

### Slide: Following up on what it finds

- **A sick pair?** `netmesh paths --compare web03:db01 web01:db01` — prints the two routes side by side and marks the **first hop where they differ**. That hop is where to look.
- **A clean baseline?** Then the network isn't your problem — go load it: `iperf-orchestrator all`, `mx run`.
- **A host that's still slow?** Check the box itself before blaming the network again.
- Cleanup is automatic for `check` (it removes everything it deployed); for managed runs, `stop` keeps the reports and `clean` verifiably removes every trace.

**Notes:** The comparison trick in paths --compare is the practical gem: a sick route diffed against a healthy one turns "somewhere in the fabric" into "this hop". And the report itself tells you when to stop debugging the network — a clean baseline pointing you at the load tools closes the loop of the talk.

---

### Slide: Tutorial — netmesh in five minutes

```
# 0. prove the machinery works -- loopback only, no ssh needed
netmesh selftest

# 1. the two-host check: deploy, probe, report, clean up
netmesh check web01 db01
netmesh check web01 db01 --for 60      # a longer look

# 2. hunting a fault that comes and goes: sweep the paths
#    inside a LAG/ECMP bundle
netmesh check web03 db01 --flows 8
```

- `check` leaves nothing behind — it deploys its agents, probes, prints the report and cleans up after itself.
- The report ends with *what to do next*, including "the network is not your problem" when that's the truth.

**Notes:** selftest first is the confidence builder — two agents over loopback, no second machine, no privileges. Then the two-host check is genuinely the whole experience for most users; --flows is the flag to remember when a fault reproduces only sometimes, because which bundle member you hash onto is luck until you sweep.

---

### Slide: Tutorial — repeat runs and load testing

```
# a standing mesh you can re-run
netmesh gen --servers prod.txt
netmesh run --for 300 --grid grids/    # 5 minutes + N x N grids

# measure what a load test does to latency:
# 20 s idle baseline, then keep probing while the load runs
netmesh run --baseline 20 -- ./iperf_orchestrator.sh all

# a sick pair? find the hop where its route diverges
netmesh paths --compare web03:db01 web01:db01

netmesh clean                          # managed runs: verified removal
```

- Same verbs as mx (`gen / start / status / summarize / stop / clean`) and the same grid format — learn one, know both.
- In every report, **blank means "not measured" — never zero.**

**Notes:** The --baseline wrapper is the closing move of the whole talk: baseline, then load, one report showing both. Grids land next to mx's grids in the same spreadsheet. And the honesty rule one last time — a pair that stopped answering writes blanks, because averaging zeros in would flatter the baseline, and a baseline tool must never flatter.

---

## Close

---

### Slide: Putting it together

=> reachable | keep the list real -> netmesh | idle baseline -> iperf-orchestrator | TCP bandwidth -> mx | packets per second -> netmesh --baseline | latency under load

- **1 · Start with the list** — `reachable prod.txt -i` comments out dead servers, so every later step measures the fleet, not the list.
- **2 · Baseline while idle** — `netmesh check` gives the latency, loss and MTU numbers every later result is read against. Safe on production.
- **3 · Load it with bytes** — `iperf-orchestrator all` floods every link both ways: the bandwidth ceiling, and the first look at what breaks.
- **4 · Load it with packets** — `mx run` finds the answered-packets-per-second ceiling: the shape of real RPC and storage traffic.
- **5 · Measure the cost** — wrap netmesh around a load run to see what the load did to latency for everyone else on the path.
- Three habits: **baseline before load** · **trust what arrived, not what was sent** · **keep the list real**.

**Notes:** Walk the flow left to right, one sentence per box — it's the whole talk replayed in thirty seconds. Each stage's answer is the context for the next: a pruned list makes the baseline trustworthy, the baseline makes the load numbers readable, and the two load ceilings — bytes and packets — bracket what the fabric can really do. The last box closes the loop: throughput always has a latency price, and measuring it is one wrapper command. Everything installs with pip; netmesh and reachable ship together in one package alongside the two orchestrators.
