# KAKSHA

**Space Debris Tracking, Conjunction Screening & Encounter Analysis**
Smart India Hackathon — Problem Statement 83

---

## The core principle

```
PHYSICS CALCULATES  →  VALIDATION VERIFIES  →  RISK ENGINE RANKS
                    →  VISUALISATION SHOWS  →  LLM EXPLAINS
```

The numerical engine is the scientist. The LLM is not.

Every position, time of closest approach, miss distance, relative velocity,
encounter geometry and risk score in this system is produced by a numerical
pipeline and independently validated before it is displayed. The language model
sits at the very end of that chain, receives finished numbers, and writes prose.
It cannot propagate an orbit, cannot solve for TCA, cannot change a value and
cannot re-rank a result — and this is enforced mechanically, not just requested
in a prompt.

---

## Quick start

**Prerequisites:** Python 3.11+, Node 18+, and an internet connection on first
run (orbital elements are fetched live from CelesTrak).

### 1. Clone

```bash
git clone https://github.com/saransh2809/Spacce-Debris.git
```

### 2. Install

Backend:

```bash
cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
```

Frontend:

```bash
cd frontend && npm install
```

### 3. Configure

`backend/.env` is deliberately not in the repository — it holds secrets. Create
your own from the template:

```bash
cp backend/.env.example backend/.env
```

Every setting in it is optional. The system runs fully without an API key; see
*the explanation layer* below.

### 4. Run

Two processes, in two terminals. **Backend first** — the frontend is useless
without it, and says so rather than showing empty panels.

Backend (port 8000):

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Frontend (port 5173):

```bash
cd frontend && npm run dev
```

Then open **http://localhost:5173**.

On Windows, `start-backend.cmd` and `start-frontend.cmd` in the repository root
do the same thing and create the venv or install `node_modules` if either is
missing. In PowerShell they need a `.\` prefix, and the path must be quoted if
it contains spaces.

First launch downloads ~18,700 orbital element sets plus the SATCAT from
CelesTrak and takes 30–60 seconds. Subsequent starts use the local cache.

### Verifying the install

```bash
cd backend && .venv/Scripts/python -m pytest -q
```

156 tests, about a second. These run entirely offline against fixed reference
vectors, so a green suite means the numerical pipeline is sound even if the
network is not.

### Optional: the explanation layer

Two providers are supported. Supply **one** key in `backend/.env`.

**Google Gemini:**

```
KAKSHA_GEMINI_API_KEY=AIza...
KAKSHA_LLM_MODEL=gemini-2.5-flash
```

**Anthropic Claude:**

```
KAKSHA_ANTHROPIC_API_KEY=sk-ant-...
KAKSHA_LLM_MODEL=claude-opus-5
```

The provider is inferred from the model id, falling back to the key format.
Set `KAKSHA_LLM_PROVIDER=anthropic|gemini` to override. If neither the model
nor the key identifies a vendor, `/api/health` says so explicitly instead of
failing later at call time.

Without a key the system is **fully functional**. The explanation panel falls
back to a deterministic template built directly from the numbers and labelled as
such. Nothing else changes, because nothing else depends on the model.

### Ports

The backend's CORS allowlist is `localhost:5173` and `127.0.0.1:5173`. If Vite
starts on a different port because 5173 is taken, every API call will be blocked
by the browser. Free 5173 rather than letting Vite pick another port, or add the
new origin to `cors_origins` in `backend/app/core/config.py`.

---

## What it actually computes

| Stage | Method | Module |
|---|---|---|
| Element parsing | TLE/OMM, checksum + physical range validation | `data/tle_processor.py` |
| Propagation | SGP4/SDP4, Vallado reference implementation | `propagation/sgp4_engine.py` |
| Frames | TEME → ITRF → WGS-84 geodetic; RIC for covariance | `core/frames.py` |
| Broad phase | Apogee/perigee shell overlap, sort-and-sweep | `conjunction/screening.py` |
| Coarse phase | k-d tree spatial query on a time grid | `conjunction/screening.py` |
| **TCA** | **Brent root-finding on r·v = 0** | `conjunction/tca.py` |
| Encounter plane | Foster B-plane normal to relative velocity | `conjunction/bplane.py` |
| Uncertainty | RIC covariance, projected into the encounter plane | `uncertainty/models.py` |
| Validation | Independent re-derivation with tolerances | `validation/engine.py` |
| Risk | Weighted, fully explainable screening score | `risk/engine.py` |
| Explanation | LLM with a post-generation numeric audit | `llm/` |

### TCA is solved, not sampled

A 60-second coarse sweep locates an encounter to ±30 s. At a 14 km/s closing
speed that is ±420 km of miss distance — a useless number. KAKSHA refines it by
solving

```
g(t) = r_rel(t) · v_rel(t) = 0
```

with Brent's method to a tolerance of 1 µs. This is root-finding, not
minimisation, because `g` crosses zero transversally while `|r_rel|` is flat at
its minimum — minimising the distance directly throws away half the available
precision.

**The test that proves it:** an exhaustive 0.01-second search across ±5 s of the
reported TCA must not find a closer approach. It does not.
(`tests/test_conjunction.py::test_brent_beats_brute_force_sampling`)

### The screening gate is proven safe, not assumed

A coarse step can hide an encounter between two samples. The gate must satisfy

```
gate ≥ threshold + v_max · step / 2
```

With `v_max` = 16 km/s (the physical worst case for two Earth-orbiting objects),
a 60 s step and a 25 km threshold, the gate must be **≥ 505 km**. The screener
computes this and **refuses to run** below it rather than silently missing
conjunctions.

### The B-plane is real geometry, not an illustration

At TCA the relative position is exactly perpendicular to the relative velocity,
so the 3D encounter reduces to a 2D problem **with no approximation**. The
out-of-plane residual is displayed as the proof: on live data it comes out at
**~10⁻⁶ km — a millimetre.** If that number were not tiny, the TCA would be
wrong.

---

## Scientific honesty

This is the part that matters most, and the part most easily faked.

### There is no covariance in public orbital data

Public GP/TLE feeds do not publish covariance. Any system that ingests TLEs and
prints a "probability of collision" to three significant figures is **inventing
its most important input**.

KAKSHA does not do this. Instead:

- Every covariance carries a **source tag** — `PUBLISHED`, `ASSUMED_MODEL` or
  `UNAVAILABLE` — which travels with the number all the way to the UI.
- The assumed model is **documented in full** on the Validation page: 1σ values
  in the RIC frame, growing linearly with time from the element epoch, no
  invented correlations.
- A probability computed from assumed covariance is **never** called
  "probability of collision". It is a *conditional encounter probability*, it
  always carries `is_operational_pc: false`, and it is always accompanied by an
  explicit caveat.
- The headline ranking number is a **screening-priority score**, not a
  probability. It answers "which encounter should a human look at first", which
  is the question this data can legitimately answer.

### Real-time calculation, not real-time measurement

The system propagates **published orbital elements**. It does not observe
satellites. The interface says "elements loaded" and shows the age of the data,
never "live tracking". Every response carries the element epoch, the data
retrieval time, the propagation time and the simulation time.

### Stated approximations

- Polar motion neglected in TEME → ITRF (< 15 m on the sub-satellite point,
  **zero** effect on conjunction geometry, which never leaves TEME)
- UT1 ≈ UTC (< 0.5 km of longitude, again zero effect on conjunctions)
- Manoeuvres are not modelled
- SGP4 accuracy degrades by kilometres per day from epoch in LEO

All of these appear on the Validation page. A system that cannot describe its
own error budget is the one to distrust.

---

## How the LLM is contained

Three independent layers, because a system prompt is a request, not a guarantee:

1. **Structural** — the model receives a serialised result. It has no catalogue,
   no propagator and no tools in scope. It *cannot* compute anything.
2. **Instructional** — an explicit system prompt forbidding calculation,
   invention, re-ranking, and collision-probability language.
3. **Mechanical** — after generation, **every numeral in the output is traced
   back to a supplied value**, allowing for rounding and unit conversion.
   Untraceable numbers are reported to the UI as an audit failure. A separate
   scanner catches overstated claims, with negation handling so the system's own
   disclaimer isn't flagged as a violation.

The audit result is displayed next to the explanation. The reader sees not just
what the model said, but whether it can be trusted.

All three layers operate on the finished text, so they hold identically
whichever vendor generated it. Claude and Gemini are interchangeable here, and
neither is given tools: automatic function calling is explicitly disabled on the
Gemini path so no future edit can quietly open a route back into the pipeline.

---

## Verification

```bash
cd backend && .venv/Scripts/python -m pytest -q
```

**175 tests, ~1 second.** The important ones check against sources outside this
project:

- **SGP4 vs the published Vallado verification case** (catalogue 00005) —
  agreement to **7 micrometres** in position
- **GMST vs the IAU-82 definition** at J2000.0 — exact to 6 decimal places
- **Solar declination** at solstices — ±23.44°, which is what makes the
  day/night terminator real
- **Geostationary velocity in ITRF ≈ 0** — proves the ω × r transport term
- **Brent TCA vs 0.01 s brute force** — the solver wins
- **Numeric audit catches a fabricated altitude** planted in an explanation
- **Provider routing** — a model id always outranks a contradicting key
  format, so a Gemini key never gets sent to Anthropic or vice versa

---

## Architecture

```
backend/app/
  core/          config · structured logging · timebase · reference frames
  data/          TLE/OMM processor · CelesTrak provider · catalogue · metadata
  propagation/   SGP4 engine · simulation clock
  conjunction/   screening · TCA · B-plane · orchestrator
  uncertainty/   covariance models · Foster 2D integral
  validation/    independent numerical checks
  risk/          explainable scoring engine
  llm/           explainer · guardrails
  api/routes/    catalogue · conjunctions · propagation · analysis
  schemas/       serialisers

frontend/src/
  components/globe/    Three.js Earth, object field, orbits
  components/bplane/   interactive encounter-plane view
  components/panels/   catalogue rail, analysis rail, hover card, explanation
  components/charts/   histograms, encounter profile
  pages/               dashboard · tracker · conjunctions · calculations ·
                       analysis · simulation · validation
```

Layer rule: **no orbital mechanics in the frontend, no risk logic in the UI, no
LLM logic in the numerical engine.** The browser receives finished numbers and
renders them.

---

## Performance

Screening 72 Indian assets against the full 18,700-object catalogue over 48
hours:

| Stage | Count |
|---|---|
| Catalogue | 18,704 |
| After shell filter | 3,750 |
| Geometrically possible pairs | 51,734 |
| Within coarse gate | 16,087 |
| Refined with Brent | 600 |
| **Validated conjunctions** | **145** |

**~7 seconds**, cached for 10 minutes and served in ~6 ms thereafter. Running the
geometric filter *before* building the propagation universe — so GEO and MEO
objects never cost an SGP4 call when the primaries are all in LEO — took this
from 111 s to 14 s; querying a k-d tree of secondaries with primary positions
rather than enumerating all neighbouring pairs took it the rest of the way.

The 3D scene renders 12,000 objects plus 4,500 stars in **7 draw calls** by using
two `THREE.Points` clouds rather than per-object meshes. Satellite positions stay
in the inertial frame and the Earth mesh rotates by GMST — one rotation instead
of twelve thousand.

---

## Data sources

- **Orbital elements** — CelesTrak GP (`gp.php`), public, no credentials
- **Object metadata** — CelesTrak SATCAT (`satcat.csv`) for country, operator,
  object type and radar cross-section

Country attribution comes **only** from SATCAT. It is never inferred from an
object's name. Where SATCAT has no entry, the UI shows "attribution
unavailable" rather than a plausible-looking guess.

The provider is an interface (`data/providers.py`); swapping in Space-Track means
implementing one class and changing one setting.
