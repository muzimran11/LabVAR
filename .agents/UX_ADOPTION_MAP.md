# SpliceVar — UX & Adoption Map
### What turns this from "a tool a lab made" into "a tool researchers buy"

*Prepared as a beta-tester + product pass on the current build (post inventory/culture removal). Grounded in the actual code, not aspiration.*

---

## 0. The one bet

Researchers don't buy feature lists. They switch tools for exactly one reason: **a loop they do 50 times a semester suddenly takes 2 minutes instead of 2 hours — and the output is better.**

For SpliceVar that loop is fixed and non-negotiable:

> **messy CSV → the exact figure my subfield expects → the correct stat → a publication-ready export**

Everything else in the app (gel/GFP, image analysis, notebook graph, design scaffold, lab math) is a *reason to stay*, not the reason to switch. The buy happens or dies on that one loop feeling like magic the first time. Right now the engine to do it exists (`PlotTab.buildSpec`, `lib/stats.ts`, `figurePresets.ts`) but it's **buried behind a confusing shell and a fragile import step.** That's the whole gap.

The rest of this doc is: who buys, the 3-minute moment that converts them, the specific friction I hit in the current build, and the prioritized UI moves — P0 (make it convert) → P1 (make it a real Prism replacement) → P2 (make the *lab* standardize on it).

---

## 1. Who actually adopts — and the trigger

Two humans, two different buys. Design for the first; the second is what makes it "big."

**The individual (grad student / postdoc / rotation student) — the adoption vector.**
Trigger: *"My figure is due tomorrow and ggplot/Prism is fighting me."* They will try anything that gets them a clean figure fast. They adopt in one sitting or never open it again. They don't pay — but they flood the lab.

**The lab / PI — the actual buyer.**
Trigger: *"Every student's figures look different, nobody can reproduce last year's analysis, and I re-explain the same stats to every rotation student."* The PI buys **consistency, reproducibility, and onboarding** — not plotting. This is where money and the "big buy" live, and the whole append-only/spec-is-the-artifact architecture is the reason SpliceVar can credibly sell it later. **The individual UX is what earns the right to that conversation.**

Implication: **optimize relentlessly for the individual's first 3 minutes.** The institutional value is real but downstream of adoption.

---

## 2. The moment that converts (first 3 minutes)

This is the single most important screen sequence in the product. Today it does **not** happen — the home screen is generic and the tools are hidden. Here's the target.

**Second 0 — Open.** Instead of today's generic hero ("Local-first experiment tracking, plotting, and statistical analysis"), the home is a **launchpad with the wedge dead-center**: one big drop target — *"Drop a CSV or Excel file → get a figure"* — with the seven tools as a clean grid beneath it and "Open example study" as the low-commitment path. A researcher should understand what this app *does for them* in one glance, without touching the sidebar.

**Second 20 — Drop.** They drop their real, messy plate-reader CSV. The app parses it (`lib/labdata.ts` already sniffs delimiter/BOM/wide-format) and lands them straight in the plot builder — no "create an experiment" dialog, no naming step. (Today `PlotWorkspace.quickPlot` does spin up a "Scratch" experiment silently, which is the right instinct — but it's one click deep in a sidebar tool most people won't find.)

**Second 40 — The forgiving mapping step.** This is where the magic lives or dies. Their headers won't match the expected `"24 Hours FUDR 12.5uM"` pattern. So show a **column-mapping preview**: detected roles (x / group / value / replicate) with dropdowns to fix them, a live 6-row data preview, and a plain-language read-back: *"Plotting GFP by dose, split by timepoint, 6 replicates."* Forgiving import is the difference between "wow" and "closed the app."

**Second 90 — The literature-template gallery.** Not a preset dropdown — a **visual gallery of the figure shapes their subfield publishes** (dose–response, paired before/after, survival, time-series), each rendered as a thumbnail *with their data already in it*. They pick the one that looks like their last paper. This is the actual differentiator per the strategy doc — "not a graph, the graph your subfield already recognizes" — and it should look like the star of the app.

**Second 120 — The stat, with guardrails.** The app already knows the data shape, so it **suggests the right test and explains why** ("2 groups, unpaired, non-normal → Mann–Whitney"), runs it (`lib/stats.ts` is SciPy-validated), and drops significance brackets onto the figure. The guardrail — steering them away from the wrong test — is a headline feature, not a Stats tab they have to find.

**Second 150 — Export they'd put in a manuscript.** One button → 300-DPI PNG / vector PDF / SVG + the stats report + the reproducible spec. The PNG-on-white pipeline already exists in Rust (`flatten_png_white`). Publication-quality output is the "output" half of "analysis and output tool" and it's what makes them come back instead of re-doing it in Illustrator.

If those 150 seconds land, you have a user. If any step throws them into an empty state or a syntax wall, you don't.

---

## 3. Friction map — what I actually hit in this build

Ordered by how much each one costs you at the point of conversion.

**A. The value is invisible on open. (highest cost)**
`HomeView` leads with a generic tagline, two quick cards (Import CSV, Experimental Design), and the example. The seven real tools live only in the sidebar under a quiet "Tools" header. A first-time researcher has no idea the app can turn their CSV into a dose–response figure. **Fix: the home *is* the tool launcher + the CSV wedge (§2, second 0).**

**B. Two mental models for where work lives. (high cost)**
Plotting exists both *inside an experiment* (`ExperimentView` → Plots tab) and *standalone* (`PlotWorkspace`, which secretly creates "Scratch · <date>" experiments). Real users can't tell where their stuff went. **Fix: pick one story — "just start plotting; we'll file it for you" — and make "experiment" an optional folder you can promote a scratch into later, never a required first step.**

**C. Import is a cliff, not a ramp. (high cost — this is the wedge's make-or-break)**
The literature-shaped magic depends on headers matching specific regexes (`TIME_RE`, `DOSE_RE`, `CONTROL_RE` in `labdata.ts`). Real data won't. Today there's no visible, forgiving mapping/repair step — if inference misses, the user is stuck with no obvious recovery. **Fix: the column-mapping preview with manual override + plain-language read-back (§2, second 40). This single screen protects the entire wedge.**

**D. The differentiators are buried. (medium-high cost)**
The two things that actually differentiate SpliceVar — *literature-shaped templates* and *"which test?" guardrails* — are a preset registry and a stats tab respectively. Neither is visible until you're deep in an experiment. **Fix: surface both as first-class, visual steps in the plot flow (template gallery; inline stat recommendation).**

**E. Empty states teach nothing. (medium cost)**
Tools like Gel, Image, Notebook open cold. A researcher who lands there doesn't know what a good input looks like or why they'd care. **Fix: every tool's empty state = one line of "what this is for" + a "Load sample" button that drops in real data (you already have the seed study — reuse it per-tool).**

**F. Trust/version signals are sloppy. (low cost, high perception)**
Sidebar reads `v0.2` while the data model is several iterations past it. Small, but researchers are detail people evaluating whether to trust the app with their data. **Fix: single source of version truth; tighten copy.**

**G. Provenance is 100% invisible. (low cost now, high cost later)**
The append-only hash chain — the entire moat and the future institutional sell — is never surfaced. That's *correct* for the individual (don't nag them), but there should be a quiet, proud "reproducible · verifiable" affordance on every export so the idea plants early. **Fix: a subtle "✓ reproducible — spec + provenance saved" line on export, nothing more.**

---

## 4. What makes it a *big* buy (beyond the individual)

Once the loop converts individuals, three things turn "students like it" into "the lab standardizes on it" — and they're mostly UX/positioning, not new engines:

**Reproducibility as a visible artifact.** "The spec is the figure" means any figure can be re-opened and re-generated from its data. Make that a *button* — *"Reproduce this figure"* — and a shareable `.svar` bundle (data + spec + stats + provenance). A PI who sees a student regenerate last year's figure in one click is sold.

**A house style.** Labs crave consistent figures. A **lab theme/template** (fonts, palette, sizing applied across everyone's plots) is a near-trivial extension of the existing Vega config + theme system and is exactly what a PI pays for. This is the single highest-leverage "institutional" feature and it's mostly plumbing you already have.

**Onboarding a rotation student in one afternoon.** The example study + literature templates + stat guardrails together *are* a teaching tool. Position that explicitly ("get a rotation student from raw data to a correct, publishable figure on day one") and the PI does your selling for you.

None of these require the cloud/verification-anchor work yet. They're the honest bridge from free individual tool to paid lab tool that the strategy doc already commits to.

---

## 5. Prioritized roadmap (UI-first)

| Pri | Move | Why it matters | Rough lift |
|-----|------|----------------|-----------|
| **P0** | Redesign Home into a launchpad: CSV drop wedge + tool grid + example | Makes the value legible in one glance; the conversion starts here | Small (frontend) |
| **P0** | Forgiving column-mapping preview on import (roles + override + read-back) | Protects the entire wedge from real, messy data | Medium (frontend) |
| **P0** | Collapse the experiment/tools duality into "just start; we'll file it" | Removes the #1 source of "where did my work go?" | Medium (frontend) |
| **P0** | Literature-template **gallery** (thumbnails with the user's data) | The actual differentiator, made visible | Medium (uses existing presets) |
| **P1** | Inline "which test?" recommendation in the plot flow, with the *why* | Turns a guardrail into a headline; prevents foot-guns | Medium |
| **P1** | One-button publication export (300-DPI/PDF/SVG + stats + spec) polished | The "output" half; the reason they don't redo it in Illustrator | Small–Medium (pipeline exists) |
| **P1** | Per-tool empty states with "Load sample" | Every tool teaches itself; raises breadth of use | Small |
| **P1** | "Reproduce this figure" + `.svar` bundle | Plants the reproducibility moat; PI-facing wow | Medium |
| **P2** | Lab theme / house style applied across plots | The core institutional/paid hook | Medium |
| **P2** | Quiet provenance affordance on export ("reproducible · verifiable") | Seeds the verification story without nagging | Small |
| **P2** | Version/copy/trust cleanup | Perception of a serious instrument | Trivial |

---

## 6. What NOT to do

- **Don't add features to breadth.** The app already has 7 tools; a researcher converts on *one loop working perfectly*, not an 8th tool. Depth on the wedge beats breadth every time.
- **Don't surface provenance/verification to individuals as a feature.** It's a background property and a future *lab* sell. Leading with it to a student who wants a figure is noise.
- **Don't gate the core loop or add accounts.** The free, offline, no-login individual tool *is* the distribution engine. Anything that adds friction there caps the whole funnel.
- **Don't make "create an experiment" the mandatory first step.** Start-with-data, file-it-later. The project layer is a convenience, not a toll gate.

---

### Bottom line
The engine to make this a buy already exists in the codebase. The gap is entirely **surface**: the value is hidden on open, the import is a cliff, and the two differentiators (literature templates, stat guardrails) are buried. Fix the first 3 minutes — launchpad home, forgiving import, template gallery, inline stat — and you convert individuals. Add reproducibility-as-a-button and a lab house style, and you earn the PI. That sequence, in that order, is the path from "a tool a lab made" to "a tool researchers buy."
