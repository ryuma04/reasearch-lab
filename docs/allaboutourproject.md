# All About Our Project

## 1. The project in one minute

We are building **one web workspace where a researcher gives a machine learning research paper, and a team of AI agents reproduces the paper's main result on a normal laptop, tests it against the paper's own numbers, explains any difference, and tries "what if" ideas.** The final code, results and logs are pushed to the researcher's own GitHub account.

**What the researcher does**

- Logs in with GitHub.
- Uploads one or more research papers (PDF or arXiv link). This is required.
- Optionally adds a dataset, a GitHub repository, or a short note.
- Watches the agents work live, approves or changes the plan, and asks "what if" questions, by typing or by voice, from a laptop or a phone.

**What the system does**

- A **fixed pipeline** of agents does the work in a clear order: Research → plan approval → Coding → Testing → Gap Detective, plus What-If branches on request.
- The **Research Agent** reads the paper, pulls out every important number the paper claims, and finds the code, datasets and other sources.
- The **Coding Agent** writes the code, runs it inside a safe sandbox, and fixes its own errors.
- The **Testing Agent** creates test cases, runs them, and compares our results with the paper's results, claim by claim.
- An **Observer Agent** watches all the agents and draws a live, hand-drawn style map (Excalidraw) of what each agent found and did.
- Everything learned (errors, fixes, settings that worked) is saved in a **Lab Memory**, so the next run is faster and makes fewer mistakes.

### Our USP (the one thing that makes us different)

> **Every result number on our screen has proof behind it.**
> Existing AI research tools have one serious problem: the AI sometimes writes result numbers that were never actually produced by any experiment. In our system, the AI is never allowed to type a result. Every number comes from a file that the sandboxed code wrote while it ran, and every number is linked to:
>
> 1. the exact line in the paper (page and table) that it is compared with,
> 2. the exact run, code version and log file that produced it.
>
> When our number and the paper's number do not match, the system does not guess the reason. It **runs small tests to find the reason**, and then tells the researcher in plain words, for example: "Most of the gap comes from training for 5 epochs instead of the paper's longer training. When we trained longer, the gap fell from 41 errors to 12."

## 2. The problem statement (exact words + simple explanation)

### 2.1 The official problem statement (exact text)

<blockquote class="ps"><p class="ps-label">Official problem statement · Problem Statement 03</p>

<p><strong>An Evolving AI Research Environment</strong></p>

<p><strong>Background</strong></p>

<p>Machine learning research increasingly spans papers, datasets, code, notebooks, compute platforms, documentation, experiments, collaborators, and countless disconnected applications. Reproducing published work is difficult because implementation details, dependencies, configurations, preprocessing, datasets, and reported results may differ across sources and environments. Even after an experiment runs, researchers repeatedly face debugging, dependency conflicts, data issues, hyperparameter choices, model comparisons, failed experiments, and unanswered "what if" questions. Valuable knowledge from these successes and failures is rarely retained in a way that helps future research. As research scales, the researcher spends increasing time managing the machinery around experimentation rather than investigating the research itself.</p>

<p>AI agents are increasingly capable of reading papers, writing and debugging code, and running experiments. However, most agentic systems still depend on predefined agents, fixed roles, manually designed workflows, and known task boundaries, while every paper and research question needs a different mix of skills. A research environment built on agents therefore requires more than capable individual agents – it requires a system that can dynamically organise, coordinate, evaluate, and evolve its agents around the research itself.</p>

<p><strong>Problem Statement</strong></p>

<p>Build an intelligent research environment, powered by a dynamic team of AI agents, that can support the researcher across the complete lifecycle of machine learning research. The system should be capable of taking a paper, research question, algorithm, dataset, codebase, or experimental idea and working with the information required to turn it into meaningful experimentation. It should be able to execute research across environments such as local machines, Kaggle, Colab, remote servers, or other available compute, while handling the practical problems that arise during execution including dependencies, incompatible environments, data issues, implementation errors, resource constraints, configuration choices, and hyperparameter decisions.</p>

<p>Rather than relying on a fixed set of predefined agents, a meta-controller should determine the capabilities each research task requires – such as reading papers, implementation, environment setup, debugging, experiment design, and analysis – coordinate existing agents, and spawn or adapt new specialised agents when existing capabilities are insufficient. Agents should be evaluated through a meaningful reward loop based on research outcomes, compute cost, and researcher feedback. Agents that consistently produce valuable results should be refined, while those that fail to justify their cost or contribution should be merged, replaced, or retired.</p>

<p>The system should go beyond checking whether a paper can be reproduced. It should be capable of running experiments, observing results, diagnosing failures, repairing and improving implementations, comparing multiple papers or approaches under meaningful conditions, and determining why results differ from reported findings. When a researcher asks questions such as "what if this dataset is changed?", "what if this architecture is modified?", or "what happens under these conditions?", the system should be capable of investigating multiple possibilities rather than requiring every experiment to be manually designed and executed.</p>

<p>Experiments should not exist as isolated runs. What the system learns from successful and failed executions, debugging decisions, configurations, comparisons, and outcomes should remain useful for future research. Over time, the system should become better at deciding what to try, how to execute it, how to recover when it fails, which direction is worth pursuing next, and which agents are best suited to each task.</p>

<p>The research environment should also bring together the surrounding work that normally lives across thousands of tools: discovering and reading papers, managing research notes and Markdown files, working with datasets and code, creating documents and research outputs, maintaining experimental records, and collaborating with other researchers and authors. A researcher should be able to control ongoing work remotely, including through a mobile interface, while longer-running computation and experimentation may continue elsewhere.</p>

<p>The challenge also extends to research autonomy. Multiple possible hypotheses, methods, datasets, or experimental conditions may need to be investigated simultaneously, with the system determining which directions deserve further exploration based on evidence and previous outcomes. The researcher should remain able to inspect, intervene, guide, approve, reject, or redirect this process.</p>

<p>The system should be demonstrated on modest compute, such as a laptop CPU or free-tier Kaggle and Colab, choosing model sizes, dataset subsets, and experiment budgets that still produce meaningful evidence. Participants should take at least one paper – for example from the research directions below, spanning materials science, edge and efficient ML, CPU-scale machine learning, and 3D – reproduce its key result autonomously, investigate at least one meaningful "what if?" extension, and explain where and why their results differ from the paper.</p>

<p>Finally, the system may contain a very large number of concurrent agents, activities, decisions, experiments, resources, documents, and research threads. How these are organised and exposed to the researcher is itself a major part of the challenge. The interface should make clear what the agents are doing, why they are doing it, how they are performing, and how the team is evolving, making a complex autonomous research environment understandable and controllable without reducing the underlying capability to a simple notebook or chat interface.</p>

<p><strong>Core question:</strong> How can you build a single environment where a researcher can conduct, control, and collaborate on their entire research process while an evolving team of AI agents continuously executes, investigates, learns, and improves alongside them?</p>

<p><strong>Suggested research directions</strong> (participants may choose any paper; these are feasible on a CPU or free-tier compute)</p>

<p><strong>Materials science:</strong> CGCNN (Xie &amp; Grossman, 2018) · MEGNet (Chen et al., 2019) · Roost (Goodall &amp; Lee, 2020) · Matbench (Dunn et al., 2020) · CHGNet (Deng et al., 2023, pretrained model on CPU)</p>

<p><strong>Edge and efficient ML:</strong> Quantization and Training of Neural Networks for Efficient Integer-Arithmetic-Only Inference (Jacob et al., 2018) · Distilling the Knowledge in a Neural Network (Hinton, Vinyals &amp; Dean, 2015) · The Lottery Ticket Hypothesis (Frankle &amp; Carbin, 2019) · MobileNetV2 (Sandler et al., 2018) · MCUNet (Lin et al., 2020)</p>

<p><strong>Machine learning on a CPU:</strong> SLIDE (Chen et al., 2020) · Grokking (Power et al., 2022) · KAN: Kolmogorov–Arnold Networks (Liu et al., 2024) · Physics-informed neural networks (Raissi et al., 2019) · TabPFN (Hollmann et al., 2023) · Why do tree-based models still outperform deep learning on tabular data? (Grinsztajn et al., 2022)</p>

<p><strong>3D:</strong> PointNet (Qi et al., 2017) · Dynamic Graph CNN (Wang et al., 2019) · DeepSDF (Park et al., 2019, on a few shapes) · NeRF (Mildenhall et al., 2020, as a low-resolution "tiny NeRF") · Plenoxels (Fridovich-Keil et al., 2022)</p>

</blockquote>

### 2.2 The problem statement in simple words

Today, a researcher who wants to check or build on a paper must do a lot of slow, manual work:

1. Read the paper and find every small detail (settings, data steps, model size).
2. Find the code (if it exists) and the dataset (if it is public).
3. Install the right software versions, which often conflict with each other.
4. Fix many errors before the code even runs.
5. Run the experiment, often on a weak computer.
6. Compare their numbers with the paper's numbers, and wonder why they are different.
7. Try new ideas ("what if I change the dataset?") one by one, by hand.
8. Forget most of what they learned, because it is not saved anywhere useful.

The problem statement asks us to build **one environment** where a **team of AI agents** does this work with the researcher, and where:

- the team is **not fixed**: a manager decides which agents are needed and can create, improve, merge or remove agents,
- agents are **scored** on results, cost and the researcher's feedback,
- the system **remembers** what it learned and gets better over time,
- the researcher can **see and control** everything, including from a phone.

### 2.3 What the judges will check (our checklist)

These lines come directly from the problem statement. Our demo must clearly show each one.

| # | What the problem statement asks | Where we show it |
|---|---|---|
| 1 | Take at least one paper and reproduce its key result **autonomously** | Live run on the Distillation paper (Section 13) |
| 2 | Investigate at least one meaningful **"what if?"** extension | What-If Branches (Hero 5) |
| 3 | Explain **where and why** our results differ from the paper | Claim Scorecard + Gap Detective (Hero 1 and Hero 3) |
| 4 | Run on **modest compute** (laptop CPU, free Kaggle/Colab) | Compute Budget Planner (Hero 8), local Docker sandbox, Kaggle push |
| 5 | A **meta-controller** that decides needed capabilities and spawns new agents | Not covered: we chose a fixed pipeline of agents (Section 9) |
| 6 | A **reward loop** using outcomes, compute cost and researcher feedback | Not covered: no agent scoring in the fixed pipeline (Section 9) |
| 7 | Agents are **refined, merged, replaced or retired** | Not covered: the agents are fixed (Section 9) |
| 8 | Handle **dependencies, errors, data issues, hyperparameters** | Coding Agent repair loop (including version-conflict fixes) + labelled settings |
| 9 | **Compare multiple papers** or approaches | Paper vs Paper mode (Hero 10) |
| 10 | Experiments are **not isolated**; learning is kept for the future | Lab Memory (Hero 6) |
| 11 | Notes, Markdown, datasets, code, documents, records, **collaboration** | Workspace tabs, notes, shared live view, GitHub push |
| 12 | **Mobile / remote control** | Mobile web app with voice and typed commands (Hero 9) |
| 13 | Researcher can **inspect, intervene, approve, reject, redirect** | Approval checkpoints on every important step |
| 14 | Interface shows **what, why, how well, and how the team evolves** — not just a chat | Live Agent Board, Research Map, Claim Scorecard (team evolution not covered) |

## 3. Real facts that prove the problem

These facts come from published studies. They show that the problem is real and large.

- **70% of researchers have failed to reproduce another scientist's experiment.** This comes from a Nature survey of 1,576 researchers across all sciences.
- **Only 6% of 400 papers at top AI conferences shared their code**, and only about one third shared their data (study reported by Science and MIT Technology Review).
- In one study of 18 deep learning papers on recommendation systems, **only 7 could be reproduced** with reasonable effort, and 6 of them could be beaten by much simpler methods.
- In a study of 30 highly cited AI papers, only about **half could be reproduced** even partly.
- Code sharing has improved (papers sharing both code and data went from about 11% in 2014 to about 64% in 2024, according to a 2026 study), but **shared code still has to be installed, fixed and run**, which is where most time is lost.
- **AI agents are still weak at this task on their own.** In OpenAI's PaperBench test (20 recent ICML papers), the best AI agent in the original study reproduced only about **21%** of the required work, below human experts.
- An independent review of Sakana's "AI Scientist" found that **42% of its experiments failed because of coding errors**, and some of its written papers contained **result numbers that were made up**.
- **Papers with Code, the most used website for linking papers to code, was shut down in July 2025.** Finding the right code and dataset for a paper is now harder.

**What this means for us:** the two biggest pain points are (1) getting the code to actually run, and (2) trusting the result numbers. Our two strongest features target exactly these points: the self-repairing Coding Agent with Lab Memory, and "every number has proof".

## 4. Who uses our platform

| User | What they need | How we help |
|---|---|---|
| **Student researcher** (final year, master's, PhD) | Reproduce a paper for a project or thesis, with little compute | Runs on a laptop CPU; explains every step in simple words |
| **Research lab / professor** | Check if a new paper's claims hold before building on it | Claim Scorecard with proof; shared live view for the whole lab |
| **ML engineer in a company** | Decide if a paper's method is worth adopting | Paper vs Paper comparison on their own dataset |
| **Paper reviewer / conference reproducibility track** | Quickly check if reported results are believable | Automatic reproduction report pushed to GitHub |
| **Paper author** | Show that their paper is reproducible | Reproducibility badge and public repository |

## 5. What existing tools miss

| Tool | What it does well | What it misses |
|---|---|---|
| **ChatGPT / Gemini chat** | Explains a paper, writes code snippets | Does not run the code end to end, does not test against the paper, forgets everything |
| **Google Colab / Kaggle notebooks** | Free compute to run code | You still write, fix and compare everything by hand |
| **Sakana AI Scientist** | Writes full research papers automatically | Many runs fail from code errors; can produce made-up numbers; no live human control |
| **Agent Laboratory** | Agents for literature review, experiments and report writing | Fixed pipeline of roles; reviewers found it sometimes swaps models or datasets without reason |
| **PaperCoder (Paper2Code)** | Turns a paper into a code repository using planning, analysis and coding agents | Writes code but does not run and debug experiments, compare claims, or learn over time |
| **PaperBench (OpenAI)** | A benchmark that measures whether agents can reproduce papers | It is a test, not a tool for researchers |

**The gap:** no tool combines (a) a team of agents that changes based on the paper, (b) real execution on small compute, (c) claim-by-claim checking with proof, (d) testing the reasons for differences, (e) memory that improves future runs, and (f) clear live control for the researcher. That combination is our project.

## 6. Our solution in simple terms

Our solution has five parts that work together.

1. **The Workspace.** The place where the researcher uploads papers, data, code and notes, and later sees all results, notes and history. Each research project is one workspace.
2. **The Agent Pipeline.** Three core agents (Research, Coding, Testing), each with two sub-agents, plus the Gap Detective and the What-If Planner, plus an Observer that draws the live map. The agents and their order are fixed.
3. **The Sandbox.** A safe, isolated box (a Docker container) where all code is installed, written, run and tested. It has limits on CPU, memory, time and internet access, so nothing can harm the computer.
4. **The Lab Memory.** A database of everything learned: errors and their fixes, settings that worked, and the result of every experiment.
5. **The Control Room.** The screens (web and mobile) where the researcher watches the agents live, sees why each decision was made, approves or rejects steps, asks "what if" questions, and receives a final report.

## 7. The full workflow, step by step

This is exactly what happens from start to end.

**Step 1: Log in.** The researcher logs in with GitHub. This one step also connects GitHub, so the system already knows where to push the final code. (If they skip it, the system asks them to connect GitHub before any push.)

**Step 2: Create a workspace and upload.**
- **Required:** one or more research papers (PDF file or arXiv link). For the demo we use one paper; for comparison mode we use two.
- **Optional:** a dataset (file or link), a GitHub repository link, and a short note (for example "I only have a laptop, keep it under 15 minutes" or "focus on Table 2").
- The researcher also picks a compute budget: "Quick (about 5 minutes)", "Standard (about 15 minutes)" or "Deep (Kaggle GPU)".

**Step 3: A new tab opens: the Live Agent Board.** The researcher sees each agent as a card with its current task in one simple sentence, for example "Reading page 4: training settings" or "Installing PyTorch 2.3".

**Step 4: The paper is fetched.** The system gets the paper in the most accurate form available: the arXiv LaTeX source and PDF for an arXiv link, or the uploaded PDF.

**Step 5: The Research Agent works.**
- Sub-agent 1 (Paper Reader) extracts the text, tables, equations and figures, and lists every result the paper claims (the **Claims List**), with page numbers.
- Sub-agent 2 (Source Finder) finds and checks the official code, datasets and pretrained models (or studies the ones the user uploaded).
- Output: a **Research Brief** — what the paper does, the exact settings, the Claims List, the sources found, missing details, and a recommendation (for example "the official code exists but needs an old library version; we recommend a clean re-implementation").

**Step 6: Checkpoint 1 — the Research Map and plan approval.** Before any code is written, the researcher sees the **Research Map** (an Excalidraw-style drawing made by the Observer Agent) showing the paper, its claims, the sources found and how they connect. The researcher also sees every setting the code will use, each labelled with its source (paper, our assumption, or changed to fit the compute budget). The researcher can approve the plan, edit it ("use only 10,000 training images"), or reject it.

**Step 7: The Coding Agent works (inside the sandbox).**
- Sub-agent 1 (Code Writer) writes the code and installs what it needs.
- Sub-agent 2 (Code Reviewer and Debugger) reviews the code before running it, then reads any error after running and fixes it.
- The loop repeats (write → run → read the error → fix) up to a set limit. Before trying a new fix, it first checks the Lab Memory for a known fix.
- Output: working code, the trained model and a **metrics file** written by the code itself.

**Step 8: The Testing Agent works.**
- Sub-agent 1 (Test Designer) takes the Claims List from the Research Agent and writes test cases: small correctness tests (for example "the softened probabilities add up to 1") and claim tests (for example "the distilled model's test errors are within 10% of the paper's 74").
- Sub-agent 2 (Test Runner) runs the tests in the sandbox and fills the **Claim Scorecard**: Match, Close, or Different for every claim.

**Step 9: If results differ, the Gap Detective runs.** It lists the differences between our setup and the paper's setup, runs quick small experiments to check which difference causes the gap, and writes a plain explanation.

**Step 10: "What if" questions.** The researcher asks "what if" questions. Each becomes a branch with its own small experiment. Weak branches are stopped early to save compute.

**Step 11: Results page.** The Live Agent Board changes into a Results page with one tab per agent: Research, Coding, Testing, plus Scorecard, What-Ifs and Memory. Clicking an agent opens its full work in a new tab.

**Step 12: Checkpoint 2 — push to GitHub.** The researcher approves. The system scans for secrets (passwords, keys), then an n8n workflow pushes the complete project to the researcher's GitHub repository with meaningful commits. The repository link appears in the profile and on the dashboard.

**Step 13: The system learns.** All errors, fixes, settings and outcomes are saved to the Lab Memory, so the next run is faster.

## 8. The agents: who does what

Our agents form a **fixed pipeline**: the same agents run in the same order for every paper, and each one has a clear job. This section explains each agent; Section 9 explains why we chose a fixed pipeline.

### 8.1 The pipeline at a glance

| Order | Agent | Job |
|---|---|---|
| 1 | Research Agent (Paper Reader, Source Finder) | Reads the paper, builds the Claims List, finds sources, writes the Research Brief |
| 2 | Checkpoint 1 | The researcher approves, edits or rejects the plan |
| 3 | Coding Agent (Code Writer, Code Reviewer and Debugger) | Chooses and labels settings, writes the code, runs it in the sandbox, fixes errors |
| 4 | Testing Agent (Test Designer, Test Runner) | Writes and runs tests, fills the Claim Scorecard |
| 5 | Gap Detective | Runs only when a claim is Different: tests the reasons with small experiments |
| on request | What-If Planner | Turns a what-if question into branches |
| always | Observer | Draws the live Research Map from every event |

### 8.2 Agent 1: Research Agent (2 sub-agents)

**Sub-agent 1.1: Paper Reader (text extraction, OCR and insights)**
- Gets the paper's content in the most accurate way available, in this order:
  1. **arXiv LaTeX source** (if the paper is on arXiv): arXiv provides the original source files of most papers. This gives the exact equations and table numbers with no OCR mistakes. Most tools do not use this.
  2. **Docling** (free, open-source PDF reader that runs on CPU): turns the PDF into structured text, tables and sections.
  3. **OCR** for scanned PDFs (Docling's built-in OCR), and **Gemini Flash vision** to read figures and charts.
- Produces:
  - a summary in simple words,
  - the method, step by step,
  - every setting (learning rate, batch size, number of layers, epochs) with its page number,
  - the **Claims List**: every result number the paper reports, with page, table and the exact condition (for example "Table 1, page 3: distilled small model, 74 test errors on MNIST"),
  - the **Missing Details List**: settings the paper does not state.

**Sub-agent 1.2: Source Finder**
- If the user gave sources: studies the uploaded GitHub repository and dataset (structure, how to run, licence, size).
- If not: searches for them using free services: GitHub search, Hugging Face (datasets, models and paper pages), Semantic Scholar, OpenAlex, arXiv and Kaggle datasets.
- Checks each source: Is it official (by the authors)? Does the licence allow use? How big is it? Does it fit the compute budget?
- Finds related newer papers that improve on this one, for the recommendation.

**Output of the Research Agent:** the **Research Brief**, which contains the summary, settings, Claims List, Missing Details List, sources found, and a recommendation (for example: "Use the official dataset loader from torchvision; the official code is not available; a 2019 follow-up paper reports a better method, which can be a 'what if' branch").

### 8.3 Agent 2: Coding Agent (2 sub-agents)

**Sub-agent 2.1: Code Writer**
- Writes a clean project: data loading, model, training, evaluation, and a configuration file with every setting in one place.
- Every script must write its results to a `metrics.json` file. This is how we guarantee that numbers come from real runs (Hero 2).
- Writes a `requirements.txt` with exact versions so the run can be repeated.
- Chooses every setting and labels its source: from the paper, our assumption (for details the paper does not state), or changed to fit the compute budget (for example a smaller, balanced subset of the data and fewer epochs).

**Sub-agent 2.2: Code Reviewer and Debugger**
- **Before running:** reviews the code against the Research Brief (for example "the paper uses temperature 20, but the code uses 2").
- **After running:** reads errors, finds the cause and fixes it. It first searches the Lab Memory for the same error; if a known fix exists, it applies that fix immediately.
- If installation fails twice (version conflicts), it relaxes library version pins and finds compatible versions.
- Stops after a set number of failed tries (for example 5) and asks the researcher for help, with a clear description of the problem.

**Languages:** Python is the main language, because almost all ML research code is in Python. We also prepare a second sandbox image for **R** (common in statistics papers). We keep it to these two to stay reliable.

**Output of the Coding Agent:** working code, trained model files, logs and `metrics.json`. All of it is pushed to the researcher's GitHub after approval (Section 17).

### 8.4 Agent 3: Testing Agent (2 sub-agents)

**Sub-agent 3.1: Test Designer**
- Connects to the Research Agent's output and reads the Claims List and settings.
- Writes two kinds of tests (with `pytest`):
  - **Correctness tests:** check that parts of the code do the right thing, for example "softmax with temperature sums to 1", "the model has the number of parameters the paper describes", "train and test data do not overlap".
  - **Claim tests:** compare each result with the paper, with a tolerance, for example "distilled model test errors ≤ 74 × 1.10".

**Sub-agent 3.2: Test Runner**
- Runs all tests inside the sandbox.
- Fills the **Claim Scorecard**:
  - **Match:** within the tolerance.
  - **Close:** a small difference with a known reason (for example, fewer epochs).
  - **Different:** a large difference; this starts the Gap Detective (Hero 3).

**Output of the Testing Agent:** test files, the test report and the Claim Scorecard.

### 8.5 Observer Agent (the map drawer)

- **What it is:** A watching agent. It does not do research work. It listens to every event from every agent.
- **What it does:** Turns events into a live drawing in **Excalidraw** style (hand-drawn boxes and arrows): the paper in the middle, its claims around it, the sources found, the code files created, the tests, and arrows showing "this claim is tested by this test" or "this dataset feeds this script".
- **When the user sees it:** live during the run, and especially at Checkpoint 1, after the Research Agent and before the Coding Agent, as requested.
- **Why it matters:** The problem statement says the interface must make clear what the agents are doing and why. A drawing is much easier to understand than a long log.

### 8.6 Gap Detective and What-If Planner

| Agent | When it runs | What it does |
|---|---|---|
| Gap Detective | A claim is marked "Different" | Tests the reasons for the difference with small one-change experiments (Hero 3) |
| What-If Planner | The researcher asks a what-if question | Turns the question into branches and runs them with successive halving (Hero 5) |

## 9. Why a fixed pipeline (a deliberate decision)

The problem statement asks for a meta-controller that spawns new agents, a reward loop that scores agents, and agents that are refined, merged, replaced or retired. **We decided not to build these.** Our agents and their order are fixed.

- **Why:** a fixed pipeline is simpler to build, test and explain, and it behaves the same way on every run, which matters for a live demo. Our effort goes into what makes results trustworthy: every number has proof, differences are tested, and fixes are remembered.
- **What this means for judging:** checklist rows 5, 6 and 7 (Section 2.3) are not covered.
- **What still improves over time:** the Lab Memory. Error fixes are reused, and settings that worked are remembered for similar papers.

### 9.1 Researcher control

- Every agent card has buttons: **Pause, Stop, Retry, Give instruction.**
- The researcher approves or rejects the plan, long runs and the GitHub push.

## 10. Must-build features (required by the problem statement)

These features are not optional. Each one comes from a line in the problem statement.

1. **Login with GitHub, profile and GitHub connection** — account details, connection status, choose or create a repository, revoke access.
2. **Workspace with uploads** — paper(s) required; dataset, repository and note optional; compute budget choice.
3. **Research, Coding and Testing agents with sub-agents** — Sections 8.2 to 8.4.
4. **Safe sandbox execution** — all code runs inside Docker with limits.
5. **Automatic error repair** — the write → run → fix loop.
6. **Claim Scorecard** — our numbers vs the paper's numbers, claim by claim.
7. **Explanation of differences** — the Gap Detective.
8. **At least one "what if" extension** — What-If Branches.
9. **Lab Memory** — learning that carries to future runs.
10. **Live Agent Board** — what each agent is doing and why.
11. **Approval checkpoints** — approve the plan, approve long runs, approve the GitHub push.
12. **Mobile control** — the web app works on phones, with voice and typed commands.
13. **Push to GitHub through n8n** — with secret scanning and meaningful commits.
14. **Research notes in Markdown** — a notes tab in every workspace; agents also write their notes here.

## 11. Hero features (our "wow" features)

These are the features judges will remember. Each one solves a real problem from Section 3, and each one has a clear demo moment.

### Hero 1: Claim Scorecard with paper highlights

- **What it is:** A table with one row per claim from the paper: the paper's number, our number, the difference and the status (Match, Close or Different).
- **What makes it special:** Clicking a row opens the paper PDF at the **exact page with the number highlighted**, and next to it, the **exact log line** from our run that produced our number.
- **How it works:** The Paper Reader saves the page number and position of each number it extracts. The PDF is shown with PDF.js (free) and the position is highlighted.
- **Demo moment:** Click "Distilled model: 74 errors". The PDF jumps to the table on the correct page with "74" highlighted, and on the right our log shows `test_errors: 81`.

### Hero 2: No number without proof

- **What it is:** A strict rule built into the system: **the AI is never allowed to write a result number.** Every result shown on screen, in the report or in the README comes only from `metrics.json` files written by code that actually ran in the sandbox.
- **Why it matters:** Independent reviews found that existing AI research systems sometimes report numbers that no experiment produced. This rule removes that risk completely.
- **How it works:**
  1. When a run finishes, the Go backend reads `metrics.json` and saves each number with the run ID, code version (git commit) and a fingerprint (hash) of the log file.
  2. Reports are built from templates that pull numbers from the database. The AI writes only the explanation text around them.
  3. A final checker scans the AI-written text; if it contains any number that is not in the database for that run, the sentence is flagged and removed.
- **Demo moment:** Hover over any number on screen: a small card shows "From run #7 · commit a1b2c3 · log line 214 · 10 Oct, 14:32".

### Hero 3: Gap Detective — tests the reason for a difference

- **What it is:** When our result differs from the paper, most tools stop at "the result is different". The Gap Detective **finds out why by testing it**.
- **How it works, step by step:**
  1. It lists every difference between our setup and the paper's setup, using the Research Brief and the Missing Details List. Example: "we trained 5 epochs, the paper trained much longer", "we did not shift input images, the paper did", "we used a 20,000-image subset".
  2. It ranks these by how likely they are to matter.
  3. For the top 2 or 3 differences, it runs a quick small experiment that changes only that one thing.
  4. It measures how much each change closes the gap.
  5. It writes a plain explanation with the evidence.
- **Example output:** "Our distilled model made 81 errors; the paper reports 74. Training longer reduced it to 77 (explains about 4 of the 7 errors). Adding the paper's image shifting reduced it to 75. The rest is likely normal variation between runs (3 runs with different seeds ranged from 74 to 78)."
- **Why it matters:** The problem statement directly asks us to "explain where and why your results differ from the paper". We answer with evidence, not guesses.

### Hero 4: Missing Details Log (every assumption is visible)

- **What it is:** Papers often leave out details. Every setting in our code is labelled with where it came from:
  - **Green — from the paper** (with page number),
  - **Blue — from the official code** (with file and line),
  - **Orange — our assumption** (with the reason, for example "common default for this model type"),
  - **Red — changed to fit compute** (for example "dataset reduced to 20,000 images to fit the 15-minute budget").
- **Why it matters:** This makes our reproduction honest and easy to check. It also tells the Gap Detective where to look first, because orange and red settings are the most likely causes of differences.
- **Demo moment:** Open the configuration file view: each line has a coloured dot; hovering shows the source.

### Hero 5: What-If Branches with early stopping

- **What it is:** The researcher asks a "what if" question in plain words (typed or spoken). The system turns it into several small experiments (branches) and runs them in parallel.
- **Example:** "What if we use Fashion-MNIST instead of MNIST?" or "What if the temperature is 2, 5, 10 or 20?"
- **Smart use of compute:** All branches start with a small budget. After the first short round, the weakest half is stopped and the rest continue (this method is called **successive halving**). This finds the best options using much less compute.
- **Branches are real git branches:** each what-if branch is saved as its own branch in the researcher's GitHub repository, so nothing is lost.
- **Demo moment:** A tree view grows on screen: four branches start; two turn grey ("stopped early: clearly worse"); one turns green with the result.

### Hero 6: Lab Memory — the system learns from every run

- **What it is:** A memory of everything learned, saved in the database with search by meaning:
  - **Error memory:** an error message and the fix that worked, for example "`numpy` 2.0 breaks this old code → pin `numpy<2`".
  - **Settings memory:** settings that worked for a kind of model and a compute budget.
  - **Experiment memory:** every run, its settings and results.
- **How it is used:** Before fixing an error, the Debugger searches the memory. Settings that worked before are suggested for similar papers.
- **Demo moment (proof of learning):** We show the first run's timeline (for example 6 fix attempts, 9 minutes) next to a second run on a related paper (1 fix attempt, applied from memory in under a second, 4 minutes). A badge shows "Fixed from memory — learned in run #3".

### Hero 7: Live Research Map (Excalidraw)

- **What it is:** The Observer Agent draws a live, hand-drawn style map of the research, as requested by our team.
- **What it shows:** the paper, its claims, the sources, the code files, the tests and the results, with arrows showing how they connect. Nodes change colour as work progresses (grey = waiting, blue = working, green = done, red = problem).
- **How it works:** Every agent sends events (for example "found dataset", "created file train.py", "test passed"). The Observer turns them into Excalidraw elements using the free Excalidraw library's built-in function for creating elements from simple data.
- **Extra:** The researcher can draw on the map too (add notes, circle something), and can export it as an image for the PPT or report.

### Hero 8: Compute Budget Planner

- **What it is:** Before running, the system estimates how long the experiment will take **on this exact computer**, and chooses model size, dataset subset and number of epochs to fit the chosen budget.
- **How it works:** It runs a 20-second "test drive" (a few training steps), measures the speed, and calculates the time for the full run. If it does not fit, it proposes options: "Use 30% of the data (about 6 minutes)" or "Send to Kaggle GPU (about 2 minutes, uses free GPU quota)".
- **Why it matters:** The problem statement asks us to choose "model sizes, dataset subsets, and experiment budgets that still produce meaningful evidence" on modest compute. This does it automatically and shows the reasoning.

### Hero 9: Voice control from a phone, and an audio briefing

- **Talk to your lab from your phone:** The researcher speaks or types in the mobile web app, for example: "How is the run going?" or "Try temperature 5 as a new branch."
  1. **Groq Whisper** turns speech into text (very fast and free within limits).
  2. A small, fast AI model understands the request.
  3. For anything that changes the work, it asks for a one-tap confirmation: **[Yes] [No]**.
- **Notifications:** The web app shows messages such as "Run finished: 3 of 4 claims matched. Approve push to GitHub? [Yes] [No]".
- **Audio briefing:** At the end of a run, the system creates a short spoken summary (about 90 seconds) of what happened: what was reproduced, what differed and why, and what to try next. The researcher can listen on the way home. The script is written by the AI from the database (numbers inserted from real results, Hero 2), and the voice is made by **Kokoro**, a free open-source text-to-speech model that runs on a normal CPU.
- **Why it matters:** The problem statement asks for remote control "including through a mobile interface, while longer-running computation continues elsewhere".

### Hero 10: Paper vs Paper (fair comparison)

- **What it is:** The researcher uploads two papers that make competing claims, and the system tests both **under the same conditions** (same data, same compute budget, same evaluation).
- **Ready-made demo pair from the problem statement's list:**
  - **TabPFN** (2023) says a pretrained transformer can solve small tabular classification problems very fast and very well.
  - **Grinsztajn et al.** (2022) says tree-based models (like XGBoost) still beat deep learning on tabular data.
  - Our system runs TabPFN, XGBoost and a simple neural network on the same small datasets, on CPU, and shows who wins, where, and why (for example: "TabPFN wins on datasets under 1,000 rows; XGBoost wins on the larger dataset").
- **Why it matters:** The problem statement asks for "comparing multiple papers or approaches under meaningful conditions".

### Hero 11: Live Lab Stream and Run Replay

- **Live Lab Stream:** Any workspace can be shared as a read-only live link with a QR code. Teammates, a professor or the judges scan the QR code and watch the agents, the map and the scorecard update live on their own phones.
- **Run Replay:** Because every event is saved with a time, any finished run can be **played back like a video**, with play, pause, speed (1×, 4×, 16×) and a timeline slider. This lets a professor or teammate see exactly how the result was reached, step by step.
- **Demo moment:** During the pitch, we show the QR code on the slide. Judges scan it and see our live run on their phones while we present.

## 12. Extra features (if time allows)

1. **Open in Colab button:** Every pushed repository includes a notebook with a one-click "Open in Colab" link, so anyone can re-run it on free Colab.
2. **Kaggle run:** For bigger runs, the system pushes the code to Kaggle as a private notebook using the free Kaggle API, starts it on a free GPU, and pulls the results back.
3. **Reproducibility badge:** The pushed README shows a badge such as "3 of 4 claims reproduced on CPU in 11 minutes".
4. **Cost meter:** Shows tokens, sandbox minutes and money spent for every agent and every run (₹0 in our case).
5. **Comments and teammates:** Teammates can be invited to a workspace and leave comments on any claim, result or map node.
6. **Report export:** One-click export of the full report as Markdown and PDF.
7. **Hypothesis board:** A board of open questions and ideas ("Does this method work on noisy labels?"), linked to the what-if branches that tested them.
8. **Email to the authors:** For a "Different" claim, the system drafts a polite email to the paper's authors asking about the missing detail. The researcher reviews and sends it themselves.
9. **Run video export:** Record the Run Replay as a short video file in the browser, for sharing.

## 13. Which paper we demo, and why

### 13.1 Main demo paper: "Distilling the Knowledge in a Neural Network" (Hinton, Vinyals & Dean, 2015)

**Why this paper:**
- It is on the problem statement's own list (Edge and efficient ML).
- It runs on a laptop CPU in minutes (MNIST, small fully connected networks).
- Its main claim is simple and clear for any judge: a small model trained to copy a big model's "soft" answers performs almost as well as the big model, and much better than the same small model trained alone.
- It has a natural, honest gap (the paper trained for a long time with extra tricks), which lets us show the Gap Detective.

**Claims we will check (MNIST, from the paper; confirm each number against the paper before the pitch):**

| Model | What the paper reports | What it means |
|---|---|---|
| Big model (2 hidden layers of 1,200 units, with dropout) | 67 test errors | The teacher |
| Small model trained alone (2 hidden layers of 800 units) | 146 test errors | The baseline |
| Small model trained with distillation (temperature 20) | 74 test errors | The key result: almost as good as the teacher |

**Our "what if" extensions:**
1. **What if the temperature changes?** (2, 5, 10, 20) — which value works best on our smaller budget?
2. **What if we use Fashion-MNIST instead of MNIST?** — does the distillation benefit still hold on a harder dataset?
3. **What if the small model is much smaller?** (for example 100 units) — how small can it get before the benefit disappears?

**Expected time on a laptop CPU:** about 3 to 8 minutes per full run with a reduced number of epochs (we will measure this exactly on our laptop before the demo).

### 13.2 Comparison demo: TabPFN vs "Why do tree-based models still outperform deep learning on tabular data?"

Used for Hero 10 (Paper vs Paper). Both run on CPU in seconds to minutes on small datasets. **Before the demo, check that the TabPFN model download works on our machine**, because newer versions may need a Hugging Face login.

### 13.3 Backup papers (if something breaks)

- **Physics-informed neural networks** (Raissi et al.) — solving a simple equation (for example Burgers' equation) on CPU.
- **KAN** (Liu et al., 2024) — the official `pykan` library has small examples that run on CPU.
- **Lottery Ticket Hypothesis** (Frankle & Carbin) — the small MNIST network version.

We should **pre-run** the main and backup papers once before the demo, so the Lab Memory already has some learning, and so we have a recorded run to show if the internet fails.

## 14. LangGraph or LangChain: our choice

**Our choice: LangGraph** (free and open-source, in Python).

**Simple explanation of the difference:**
- **LangChain** is a toolbox of building blocks for one AI step: connect to a model, write a prompt, call a tool. It is good for simple chains of steps.
- **LangGraph** is built on top of LangChain for **many agents working together in steps that can loop**. We draw our system as a graph: each agent is a box, and arrows show who works next.

**Why LangGraph fits our project exactly:**

| What we need | How LangGraph provides it |
|---|---|
| Loops (write code → run → error → fix → run again) | Graphs can have cycles; LangChain chains are mostly one-way |
| Approval checkpoints (approve plan, approve push) | Built-in "interrupt": the graph pauses and waits for the researcher, then continues |
| Save progress so a crash or restart does not lose work | Built-in checkpoints saved to Postgres |
| Several what-if branches in parallel | Parallel branches, then results are combined |
| Live updates to the screen | Streaming of every step as an event |

We still use small parts of LangChain inside LangGraph (for example, the connectors to Groq and Gemini). We do not add other agent frameworks; one framework is simpler and easier to explain.

## 15. AI plan: Groq and Gemini (both free)

We use two free AI providers. Each job uses the model that fits it best. Several API keys can be configured per provider: when one key hits its limit, the request moves to the next key, then to the other provider.

**Note (checked on our accounts):** the Llama models are not available on our Groq account, and Gemini 2.5 Flash is not available to new users, so we use the models below.

| Job | Model (free) | Why this model |
|---|---|---|
| Code Writer, Debugger, test design | **Groq: GPT-OSS 120B** | Strong at reasoning and code; Groq is very fast, so the live board feels quick |
| Code Reviewer (second opinion) | **Groq: Qwen3.8 27B** | A different model catches different mistakes |
| Writing summaries, explanations, briefing scripts | **Groq: GPT-OSS 20B** | Good, clear writing; fast |
| Quick small decisions (classify an error, understand a voice or typed command) | **Groq: GPT-OSS 20B** | Very fast |
| Reading the full paper with figures and charts | **Gemini 3 Flash** (falls back across Flash models) | Very long input (whole paper at once) and can read images |
| Speech to text (voice notes) | **Groq: Whisper Large v3 (Turbo)** | Free, fast, accurate, many languages |
| Text to speech (audio briefing) | **Kokoro** (runs on our CPU) | Free, open-source, no limits; browser voice as backup |
| Memory search (meaning-based) | **FastEmbed with a small BGE model** (runs on our CPU) | Free, no limits, no internet needed |

**Note:** model names on Groq and Gemini change often. On the day, check the exact names and limits in the Groq console and Google AI Studio.

**How we stay inside the free limits:**
1. **Cache:** the paper is read once; the result is saved and reused by all agents.
2. **Small model first:** easy tasks use the small fast model; only hard tasks use the big model.
3. **Short context:** agents get only the part of the Research Brief they need, not the whole paper.
4. **Rate limiter:** the Go backend keeps a counter per model and waits or switches provider before hitting a limit.
5. **Fallback chain:** Groq → Gemini → (optional) a free model on OpenRouter.
6. **Two free accounts:** one per team member for testing, so the demo account's daily quota stays full. (Limits are per organisation, so extra keys in the same account do not help.)

## 16. Sandbox and compute plan

### 16.1 Where code runs

| Option | Cost | When we use it |
|---|---|---|
| **Local Docker sandbox** (on our laptop) | Free | Default for everything; this matches the problem statement's "laptop CPU" |
| **Kaggle** (free GPU through the Kaggle API) | Free | When the Compute Budget Planner says the run is too slow for the laptop |
| **Google Colab** | Free | Through the "Open in Colab" button on the pushed notebook (Colab has no official API to start runs automatically) |
| **E2B cloud sandbox** | Free one-time credit for new accounts | Optional backup if the laptop's Docker fails during the event |

### 16.2 Safety rules inside the sandbox

- Each run gets a fresh Docker container, deleted after the run.
- **Limits:** for example 4 CPU cores, 6 GB memory, 256 processes, and a time limit (based on the chosen budget).
- **Internet:** on only during the install step (to download libraries and datasets), off during training and testing.
- Code runs as a normal user, not as administrator.
- Only the workspace folder is shared with the container.
- The paper and uploaded files are read-only inside the container.

### 16.3 Ready-made images to save time

We prepare Docker images in advance with common libraries already installed: Python 3.11, PyTorch (CPU), scikit-learn, NumPy, pandas, XGBoost, matplotlib, pytest. This saves several minutes per run, which matters a lot during a live demo. The second image has R with common statistics packages.

## 17. GitHub integration and the n8n push

### 17.1 Login, profile and connection

- **Login with GitHub (OAuth).** We ask for permission to read the profile and email, and to create and write to repositories.
- The **Profile page** shows: name, email, GitHub username and photo, connection status (Connected / Not connected), the selected repository, and buttons: **Choose repository, Create new repository, Disconnect**.
- **Disconnect** removes the token from our database and also cancels our access on GitHub's side through the GitHub API.
- **Security:** the GitHub token is encrypted (AES-256-GCM) before it is saved in the database. It is never sent to the browser and never written to logs.

### 17.2 The push flow, step by step

1. All code generation, review, execution and testing finish inside the sandbox.
2. The researcher clicks **Approve push**.
3. **If GitHub is not connected**, the system asks the researcher to connect it first and stops here.
4. The Go backend collects the project into a bundle and runs a **secret scan with Gitleaks** (a free, open-source tool written in Go). If a password or API key is found, the push is blocked and the file and line are shown.
5. Large files are handled: datasets are not pushed (a download script is pushed instead); model files over 50 MB go to a free Hugging Face model repository, with a link in the README.
6. The Go backend calls the **n8n workflow** (n8n runs on our machine in Docker, free).
7. The n8n workflow:
   - receives the bundle details through a webhook,
   - creates one **meaningful commit per stage** using GitHub's API: "Add research brief and claims", "Add implementation", "Add tests and results", "Add what-if: temperature sweep" (each what-if on its own branch),
   - sends the commit links back to the Go backend, which shows the repository link to the researcher.
8. The repository URL appears on the **Profile page** and the **workspace dashboard**.

**Security note for n8n:** n8n runs only inside our private Docker network (not open to the internet), and the push workflow is set to **not save execution data**, so the token is not stored inside n8n.

**Backup:** if n8n fails during the demo, the Go backend can push directly using the GitHub API (the `go-github` library), with the same steps.

### 17.3 What the pushed repository contains

```
README.md            ← summary, Claim Scorecard, badge, "Open in Colab" button
paper/
  claims.json        ← every claim with page and table
research/
  brief.md           ← Research Brief from the Research Agent
  research-map.png   ← the Excalidraw map
src/                 ← the implementation
configs/
  config.yaml        ← every setting, labelled with its source (paper / code / assumption)
tests/               ← correctness tests and claim tests
results/
  metrics.json       ← numbers written by the code during the run
  scorecard.md       ← paper vs our results
  gap-analysis.md    ← Gap Detective findings
logs/                ← full run logs
notebook.ipynb       ← one-click re-run on Colab
requirements.txt     ← exact library versions
Dockerfile           ← the exact environment
```

## 18. Final tech stack

Everything below is free.

| Layer | Technology | What it is used for |
|---|---|---|
| Frontend | **Next.js** (App Router) + **Tailwind CSS** + **shadcn/ui** | All screens; works on phone and laptop |
| Research map | **Excalidraw** (open-source library) | Hand-drawn style live map |
| Agent flow view | **React Flow** | Live graph of agents and their connections |
| Charts | **Recharts** | Training curves and scorecards |
| PDF viewer | **PDF.js** (through `react-pdf`) | Showing the paper with highlighted claims |
| Backend API | **Go** (standard `net/http` router, or the `chi` router) | Login, workspaces, uploads, live streaming, sandbox control, GitHub, voice commands, rate limiting |
| Agent system | **Python** + **LangGraph** | The fixed agent pipeline |
| Paper reading | **Docling**, arXiv source files, Gemini Flash | Text, tables, equations, figures |
| AI models | **Groq** and **Gemini** (free tiers) | Thinking, coding, writing, speech to text |
| Text to speech | **Kokoro** | Audio briefing |
| Database | **PostgreSQL** + **pgvector** | All data plus meaning-based memory search |
| Queue and live events | **Redis** | Job queue and live event channel between Go and Python |
| Sandbox | **Docker** (controlled from Go with the Docker SDK) | Safe code execution |
| Remote compute | **Kaggle API** | Free GPU runs |
| Automation | **n8n** (self-hosted, free) | GitHub push workflow |
| Secret scanning | **Gitleaks** | Block passwords and keys before push |
| Mobile control | Mobile web app (installable) | Notifications, approvals, voice and typed commands |
| Public link | **Cloudflare Tunnel** (free) | A public HTTPS link to our laptop for judges' phones |
| Frontend hosting | **Vercel** (free) or run locally | Hosting the Next.js app |

**Why the backend runs on our laptop and not on a free cloud server:** the sandbox needs Docker and real CPU power. Free cloud servers do not allow running Docker containers inside them and have very little CPU. Our laptop is also exactly the "modest compute" the problem statement asks for. Cloudflare Tunnel gives it a public link for free.

## 19. System architecture

```
                         ┌──────────────────────────────────────┐
  Researcher (laptop) ──▶│  Next.js + Tailwind (web app)         │◀── Researcher (phone)
  Judges (phone, QR) ───▶│  Live board · Map · Scorecard · Tabs  │
                         └───────────────┬──────────────────────┘
                                         │ HTTPS + live stream (SSE)
                                         ▼
                           ┌──────────────────────────────────────┐
                           │  Go backend                           │
                           │  • login (GitHub OAuth) • uploads     │
                           │  • live event stream  • rate limiter  │
                           │  • sandbox control    • secret scan   │
                           └───┬──────────┬───────────┬──────┬────┘
                               │          │           │      │
                 jobs + events │          │ SQL       │      │ webhook
                               ▼          ▼           │      ▼
                         ┌─────────┐ ┌────────────┐   │  ┌─────────┐    ┌────────┐
                         │  Redis  │ │ PostgreSQL │   │  │   n8n   │──▶ │ GitHub │
                         └────┬────┘ │ + pgvector │   │  └─────────┘    └────────┘
                              │      └────────────┘   │
                              ▼                       │ start / stop containers
                ┌──────────────────────────────┐      ▼
                │ Python agent worker          │  ┌──────────────────────────┐
                │ (LangGraph)                  │  │ Docker sandbox            │
                │ Research · Coding · Testing  │─▶│ (one fresh container      │
                │ Gap Detective · What-If      │  │  per run, with limits)    │
                │ Observer                     │  └──────────────────────────┘
                └──────────────┬───────────────┘            │ (optional)
                               │                             ▼
                               ▼                        Kaggle (free GPU)
                    Groq · Gemini (free AI)
                    arXiv · Semantic Scholar · OpenAlex · Hugging Face · GitHub search
```

**How a request flows, in simple words:**
1. The researcher uploads a paper in the web app. The Go backend saves the file and creates a new run.
2. Go puts a "start run" job into Redis.
3. The Python worker picks up the job and starts the LangGraph graph (Research Agent first).
4. When an agent needs to run code, it asks the Go backend, which starts a sandbox container, runs the code and returns the output. Go controls the sandbox so that all safety rules are in one place.
5. Every agent step sends a small event (for example "Coding Agent: installing PyTorch") to Redis.
6. Go saves every event in PostgreSQL (for Run Replay) and streams it live to every open screen (researcher, teammates, judges).
7. At a checkpoint, the graph pauses. The researcher approves on the web (laptop or phone), and Go tells the worker to continue.

## 20. Live events: how the screen stays updated

Every action by every agent creates one event. All live features (Live Agent Board, Research Map, Run Replay) are built from the same events.

```json
{
  "run_id": "r_42",
  "time": "2026-10-10T14:32:05Z",
  "agent": "coding.debugger",
  "type": "fix_applied",
  "message": "Fixed import error: pinned numpy<2 (known fix from memory)",
  "why": "Same error seen in run #3; that fix worked",
  "links": { "memory_item": "m_17", "file": "src/train.py" },
  "cost": { "tokens": 812, "sandbox_seconds": 0 }
}
```

- **Live streaming:** Server-Sent Events (SSE), a simple one-way live connection from server to browser. It is simpler than WebSockets and enough for our needs (actions from the user go through normal API calls).
- **The "why" field** is shown on every card. This is how we meet the problem statement's request to show "why they are doing it".

## 21. Folder structure

```
/
├── frontend/                    ← Next.js + Tailwind frontend
│   └── src/app/                 ← login, profile, workspaces (live board, map, results, replay), share
├── backend/                     ← Go backend
│   ├── cmd/server/main.go
│   └── internal/
│       ├── auth/                ← GitHub OAuth, sessions, token encryption
│       ├── workspace/           ← workspaces, uploads, notes
│       ├── runs/                ← runs, checkpoints, events, SSE, share links
│       ├── sandbox/             ← Docker control, limits, metrics.json with proof
│       ├── proof/               ← removes AI-written numbers that no run produced
│       ├── githubpush/          ← bundle, Gitleaks, n8n call, direct-push backup
│       ├── voice/               ← voice and typed commands (Groq Whisper)
│       ├── ratelimit/           ← AI usage counters per API key
│       └── store/               ← PostgreSQL queries and migrations
├── agents/                      ← Python + LangGraph (FastAPI service + job worker)
│   ├── app.py
│   └── lab/
│       ├── graph.py             ← the fixed pipeline
│       ├── steps.py             ← the fixed agents
│       ├── research.py          ← Paper Reader, Source Finder
│       ├── coding.py            ← Code Writer, Code Reviewer and Debugger
│       ├── testing.py           ← Test Designer, Test Runner, Claim Scorecard
│       ├── gap.py · whatif.py   ← Gap Detective, What-If branches
│       ├── observer.py          ← events → Research Map
│       ├── memory.py            ← Lab Memory (embeddings, search)
│       └── llm.py               ← Groq / Gemini router with API-key switching
├── infra/sandbox-images/        ← python/ and r/ Dockerfiles
├── n8n/github-push.json         ← exported n8n workflow
├── docs/                        ← this document and design notes
└── docker-compose.yml           ← Postgres, Redis, n8n, backend, agents
```

## 22. Database design

| Table | What it stores (main fields) |
|---|---|
| `users` | id, name, email, github_username, avatar_url, created_at |
| `github_connections` | user_id, encrypted_token, scopes, default_repo, status, connected_at |
| `workspaces` | id, owner_id, title, compute_budget, note, created_at |
| `workspace_members` | workspace_id, user_id, role (owner / editor / viewer) |
| `uploads` | id, workspace_id, kind (paper / dataset / repo_link / note), path_or_url |
| `papers` | id, workspace_id, title, arxiv_id, parsed_markdown_path, summary |
| `claims` | id, paper_id, description, value, unit, page, table_ref, position_on_page, condition |
| `settings` | id, run_id, name, value, source (paper / official_code / assumption / compute_change), source_ref, reason |
| `runs` | id, workspace_id, parent_run_id, branch_name, status, started_at, finished_at, git_commit |
| `run_events` | id, run_id, time, agent, type, message, why, links (JSON), cost (JSON) |
| `metrics` | id, run_id, name, value, log_file_hash, log_line |
| `scorecard_entries` | id, run_id, claim_id, metric_id, difference, status (match / close / different), explanation |
| `whatif_branches` | id, run_id, question, settings_change (JSON), status (running / stopped_early / done), result_metric_id |
| `memory_items` | id, kind (error_fix / setting / experiment), text, details (JSON), embedding (vector), times_used, success_rate |
| `notes` | id, workspace_id, author (user or agent), markdown, updated_at |
| `comments` | id, workspace_id, target_type, target_id, user_id, text |
| `pushes` | id, run_id, repo_url, commit_urls (JSON), status, secret_scan_result |
| `share_links` | token, workspace_id, expires_at |

## 23. API design (Go backend)

| Method and path | What it does |
|---|---|
| `GET /auth/github/login` · `GET /auth/github/callback` | Log in with GitHub |
| `GET /me` | Profile and GitHub connection status |
| `GET /github/repos` · `POST /github/repos` | List repositories / create a new one |
| `PUT /github/default-repo` | Choose the repository for pushes |
| `DELETE /github/connection` | Disconnect and revoke access |
| `POST /workspaces` · `GET /workspaces/{id}` | Create / open a workspace |
| `POST /workspaces/{id}/uploads` | Upload a paper, dataset, repository link or note |
| `POST /workspaces/{id}/runs` | Start a run with a compute budget |
| `GET /runs/{id}/stream` | Live event stream (SSE) |
| `GET /runs/{id}/events` | All saved events (for Run Replay) |
| `POST /runs/{id}/checkpoints/{name}` | Approve, edit or reject at a checkpoint |
| `POST /runs/{id}/agents/{agent}/action` | Pause, stop, retry, instruct |
| `GET /runs/{id}/scorecard` | Claim Scorecard |
| `GET /runs/{id}/settings` | Settings with their sources (Missing Details Log) |
| `POST /runs/{id}/whatif` | Ask a what-if question |
| `GET /agents` | The fixed agents of the pipeline |
| `GET /memory/search?q=` | Search the Lab Memory |
| `GET/PUT /workspaces/{id}/notes` | Markdown notes |
| `POST /runs/{id}/push` | Approve and start the GitHub push |
| `POST /workspaces/{id}/share` | Create a read-only live link and QR code |
| `POST /voice/command` · `POST /voice/text` | Understand a spoken or typed command from the mobile web app |
| `POST /internal/sandbox/exec` | (Internal, used by agents only) run code in a sandbox |
| `POST /internal/push/callback` | (Internal, used by n8n only) push result |

## 24. Outside services and their free limits

Limits change often; the numbers below are approximate, from public sources in 2026. Check them on the day.

| Service | Free limit (approximate) | Our use |
|---|---|---|
| **Groq** | No card needed; per-model limits, roughly 30 requests per minute and 1,000 to 14,400 requests per day depending on model; Whisper about 2,000 requests per day | Main AI and speech to text |
| **Gemini API** | Flash models are free with daily limits (roughly 250 to 1,500 requests per day by model) | Long paper reading, images, backup AI |
| **GitHub API** | 5,000 requests per hour per user | Repositories and pushes |
| **Kaggle** | About 30 GPU hours per week (shown in your account) | Bigger runs |
| **Semantic Scholar, OpenAlex, arXiv** | Free public APIs with fair-use limits | Finding papers, code and datasets |
| **Hugging Face** | Free datasets, models and model hosting | Datasets, pretrained models, large model files |
| **Cloudflare Tunnel** | Free | Public link to our laptop |
| **Vercel** | Free hobby plan | Frontend hosting |
| **E2B** | One-time free credit for new accounts | Optional cloud sandbox backup |
| **n8n, Docker, PostgreSQL, Redis, Docling, Kokoro, Gitleaks, LangGraph, Excalidraw** | Free and open-source, run on our machine | Core parts of the system |

## 25. All screens

1. **Login** — "Continue with GitHub".
2. **Profile** — account details, GitHub status, chosen repository, list of pushed repositories, Disconnect button.
3. **New Workspace** — upload area for papers (required), optional dataset, repository link and note, and the compute budget choice.
4. **Live Agent Board** (opens in a new tab after upload) — one card per agent with its current task in one sentence, status colour, a "why" line, cost so far, and control buttons. A top bar shows the overall stage: Research → Plan approval → Coding → Testing → What-ifs → Push.
5. **Research Map** — the live Excalidraw map. Shown in full at Checkpoint 1 with Approve / Edit / Reject buttons.
6. **Results page** (replaces the Live Board when all agents finish) — summary at the top, then tabs:
   - **Research** — Research Brief, Claims List, sources, recommendation.
   - **Coding** — files, code viewer, run logs, the repair history (each error and its fix).
   - **Testing** — test list with pass/fail, and the Claim Scorecard.
   - **Scorecard** — paper vs our numbers, with the PDF highlight view and Gap Detective explanation.
   - **What-ifs** — the branch tree and results.
   - **Memory** — what was learned in this run, and what was reused from earlier runs.
   - **Notes** — Markdown notes from the researcher and agents.
   - Clicking an agent card opens its full work in a new browser tab, as planned.
7. **Run Replay** — the timeline player.
8. **Shared live view** — the read-only version for teammates and judges (opened by QR code).
9. **Mobile view** — the same pages arranged for a phone, with large Approve / Reject buttons.

## 26. UI and UX design guidance

- **Not a chat app.** The problem statement says the interface must not reduce everything to "a simple notebook or chat interface". Our main screen is a board of agents and a map; chat is only a small side panel for instructions.
- **One sentence per card.** Each agent card shows what it is doing now in plain words. Details open on click.
- **Always show "why".** Every decision has a short reason under it.
- **Consistent colours:** grey = waiting, blue = working, green = done or matched, amber = close or assumption, red = problem or different.
- **Numbers always clickable.** Clicking any result number shows its proof (Hero 2).
- **Calm design:** a light background, one accent colour, clear fonts, enough spacing. A dark mode for long sessions.
- **Phone first for approvals:** approval buttons are large and placed at the bottom of the screen on phones.

## 27. Demo script for the judges (7 minutes)

| Time | What we show | What we say (simple) |
|---|---|---|
| 0:00–0:45 | The problem slide with 2 facts | "70% of researchers have failed to reproduce someone else's experiment. AI tools that try to help sometimes invent result numbers." |
| 0:45–1:30 | Log in with GitHub, upload the Distillation paper, choose "Quick" budget | "The researcher gives only the paper. Everything else is optional." |
| 1:30–2:30 | Live Agent Board: the Research Agent reads the paper and builds the Claims List with page numbers | "Every agent shows what it is doing right now, and why." |
| 2:30–3:15 | Research Map at Checkpoint 1; approve the plan | "Before any code is written, the researcher sees and approves the plan." |
| 3:15–4:15 | Coding Agent hits an error and fixes it from memory; judges watch on their phones via the QR code | "This error was fixed in under a second, because the system learned it in an earlier run." |
| 4:15–5:15 | Claim Scorecard: click a number, PDF highlight + log line; Gap Detective explanation | "Every number has proof. And when our result differs, we test why." |
| 5:15–6:00 | Voice command in the mobile web app: "Try temperature 5 as a new branch"; What-If tree grows; weak branches stop early | "The researcher can control the lab from a phone, by voice." |
| 6:00–6:40 | Memory tab: a fix reused from an earlier run; GitHub repository with meaningful commits and the badge | "The lab remembers what it learned. Everything ends in the researcher's GitHub." |
| 6:40–7:00 | Closing line | "One workspace where a team of AI agents reproduces, tests, explains and extends research — on a laptop, for ₹0." |

**Important:** we pre-run the full demo once on the same laptop. If the internet fails, we use Run Replay of the pre-recorded run, which looks exactly like a live run.

## 28. PPT round: slide plan

| Slide | Title | Content |
|---|---|---|
| 1 | Title | Problem statement name, team name, one-line summary |
| 2 | The problem | 3 facts from Section 3, with sources |
| 3 | Who suffers and why | The 8 manual steps from Section 2.2 as a simple flow |
| 4 | What existing tools miss | The table from Section 5 (short version) |
| 5 | Our solution | The 5 parts from Section 6 in one diagram |
| 6 | The workflow | Upload → Research → Map + approval → Code → Test → Gap → What-if → GitHub |
| 7 | The agent pipeline | Research, Coding, Testing, Gap Detective, What-If and the Observer, in order |
| 8 | Our USP: every number has proof | Scorecard screenshot with the PDF highlight and log line |
| 9 | Hero features | Gap Detective, Lab Memory, What-If Branches, Research Map, voice control, Paper vs Paper |
| 10 | Architecture and tech stack | Diagram from Section 19, all free tools |
| 11 | Demo plan and result | The paper we reproduce, its claims, what-ifs; QR code for the live view |
| 12 | Cost and impact | ₹0 cost table; who benefits; future scope |

## 29. Judge questions and our answers

- **"Your agents are fixed. Isn't that what the problem statement says to avoid?"** — Yes, it is a deliberate trade-off. A fixed pipeline is simpler and behaves the same way on every run. We put our effort into trustworthy results: every number has proof, differences are tested, and fixes are remembered in the Lab Memory.
- **"How do you know the AI didn't make up the results?"** — The AI is never allowed to write result numbers. Every number comes from `metrics.json` written by code that ran in the sandbox, saved with the run ID, commit and log fingerprint. Any number in AI-written text that is not in the database is removed.
- **"How does the system get better over time?"** — Through the Lab Memory: error fixes are reused, and settings that worked before are suggested for similar papers. We show a second run being faster than the first.
- **"Is running AI-written code safe?"** — It runs only inside a fresh Docker container with CPU, memory, time and process limits, no internet during execution, a non-administrator user, and read-only inputs.
- **"Why Go and Python both?"** — Go handles the web server, live streaming, sandbox control and security very efficiently. Python is needed because ML code and LangGraph are in Python. Each language does what it is best at.
- **"What happens when Groq's free limit runs out?"** — The router switches to the next API key, then to Gemini, automatically. We also cache the paper reading and use small models for small tasks.
- **"Why are your results different from the paper?"** — (Show the Gap Detective.) Each difference is tested with a small experiment, and the explanation is backed by those results.
- **"Can it work with other papers?"** — Yes. The paper is an input. For a paper without a built-in recipe, the AI agents read it and write the code. We also have backup papers ready (Section 13.3).
- **"What does it cost?"** — ₹0. Every tool is free or open-source, and compute is our laptop plus free Kaggle and Colab.
- **"Why not just use ChatGPT?"** — Chat tools do not run the code end to end, do not test against the paper's claims, do not keep proof, do not learn across runs, and do not push a complete project to GitHub.

## 30. Build plan and team roles

**Suggested roles for a team of 4** (adjust to our team size):

| Person | Main work |
|---|---|
| **Member 1 — Frontend** | Next.js screens: upload, Live Agent Board, Results tabs, Scorecard with PDF highlight, mobile layout |
| **Member 2 — Go backend** | Login and GitHub, workspaces, uploads, SSE events, sandbox control, rate limiter, voice commands |
| **Member 3 — Agents** | LangGraph pipeline: Research, Coding, Testing, Gap Detective, What-If, memory |
| **Member 4 — ML, sandbox and automation** | Sandbox images, demo paper runs, Gap Detective experiments, n8n workflow, Excalidraw map, PPT |

**Order of building (most important first):**

1. **Base (first quarter of the time):** docker-compose (Postgres, Redis, n8n), Go server with GitHub login, upload, a run that streams fake events to the Live Board.
2. **Core loop (second quarter):** Paper Reader → Claims List; Code Writer → sandbox run → Debugger loop; `metrics.json` → Claim Scorecard. Get the Distillation paper working end to end.
3. **What makes us win (third quarter):** Gap Detective, What-If Branches, Lab Memory reuse, Research Map.
4. **Polish and demo (last quarter):** GitHub push through n8n, voice commands, Live share link with QR, audio briefing, Run Replay, PPT, two full rehearsals.

**Rule:** after each step, the demo must still work end to end. We never leave the project in a broken state for more than one hour.

## 31. Risks and backup plans

| Risk | Backup plan |
|---|---|
| Groq or Gemini limit reached during the demo | Automatic fallback between providers; cached paper reading; separate test and demo accounts |
| Internet fails at the venue | Phone hotspot; Run Replay of a pre-recorded run; local models where possible |
| The agent writes code that keeps failing | Retry limit, Lab Memory fixes, and the main paper pre-run so known errors are already in memory |
| Training is too slow on stage | "Quick" budget pre-tested; ready-made sandbox images; Kaggle as backup |
| Docker problems on Windows | Use WSL2 with Docker Desktop; test on the demo laptop early; E2B as a cloud backup |
| n8n push fails | Direct push from Go with the same steps |
| TabPFN model download needs login | Test before the event; if blocked, compare XGBoost vs a neural network only |
| Excalidraw map takes too long to build | Show the same graph with React Flow first; switch to Excalidraw style if time allows |

## 32. Cost

| Item | Cost |
|---|---|
| AI models (Groq, Gemini free tiers) | ₹0 |
| Speech to text (Groq Whisper) and text to speech (Kokoro) | ₹0 |
| Database, queue, automation, sandbox (Postgres, Redis, n8n, Docker on our laptop) | ₹0 |
| Compute (our laptop, free Kaggle and Colab) | ₹0 |
| Hosting (Vercel free plan, Cloudflare Tunnel) | ₹0 |
| GitHub, Hugging Face, paper search APIs | ₹0 |
| **Total** | **₹0** |

**Optional spend (only if useful, within our ₹500 limit):** a cheap domain name for the first year (usually a few hundred rupees, prices vary) gives a fixed, clean link for the QR code. Without it, the free Cloudflare Tunnel link works but changes each time we restart it.

## 33. Notes from our research on past winners

- We searched for public results of past RGIT (Recursion, by RGIT CodeCell) and DJSCE hackathons. Their past winner lists and projects are **not published online in detail**, so we could not study specific winning projects. We should ask seniors or check the organisers' social media pages.
- Common patterns from winning teams at AI hackathons, which we follow in this plan:
  1. **A working live demo beats slides.** Judges trust what they see running.
  2. **One clear story.** "Upload a paper → watch the team reproduce it → see proof → ask what if."
  3. **Map the solution to the problem statement line by line** (our table in Section 2.3).
  4. **Real numbers, not claims.** Our USP is exactly this.
  5. **One memorable moment.** Judges watching the live run on their own phones through the QR code, and a voice command changing the experiment.
  6. **Be honest about limits.** Showing where results differ, and why, builds more trust than claiming perfect results.

## 34. Glossary

- **Reproduce a paper:** run the paper's method again and check if you get the same results.
- **Claim:** a result the paper reports, for example "74 test errors".
- **Agent:** an AI program that works on a task on its own, using tools (for example, running code).
- **Sub-agent:** a smaller agent that does one part of a bigger agent's job.
- **Sandbox:** an isolated box where code runs without being able to harm the computer.
- **Docker / container:** a tool that creates such isolated boxes with exact software versions.
- **LangGraph:** a free Python library to build teams of AI agents as a graph of steps, with loops, pauses for approval and saved progress.
- **Checkpoint:** a point where the system pauses and waits for the researcher's approval.
- **Embedding / pgvector:** a way to turn text into numbers so we can search by meaning; pgvector stores these in PostgreSQL.
- **SSE (Server-Sent Events):** a simple way for the server to send live updates to the browser.
- **OAuth:** the standard "Log in with GitHub" method, where GitHub gives us permission without sharing the password.
- **n8n:** a free, open-source tool to build automated workflows with boxes and arrows.
- **Distillation:** training a small model to copy the "soft" answers of a big model.
- **Temperature:** a setting that makes a model's answers softer (more spread out), which helps the small model learn more.
- **Successive halving:** start many experiments with a small budget, stop the weaker half, repeat.
- **Hash (fingerprint):** a short code calculated from a file; if the file changes, the code changes. It proves a log was not edited.
- **Seed:** a number that controls randomness; different seeds give slightly different results.
- **Epoch:** one full pass of training over the whole dataset.
- **OCR:** reading text from an image or scanned page.
- **arXiv source:** the original LaTeX files of a paper that arXiv provides for download.
- **Excalidraw:** a free tool for hand-drawn style diagrams.
- **Whisper:** a speech-to-text model. **TTS:** text to speech.

## 35. Sources

**The problem**
- [Nature: 1,500 scientists lift the lid on reproducibility](https://www.nature.com/articles/533452a)
- [MIT Technology Review: Researchers are struggling to replicate AI studies](https://www.technologyreview.com/f/610294/researchers-are-struggling-to-replicate-ai-studies/)
- [What we know about machine learning's replication crisis](https://www.greaterwrong.com/posts/j4FnzvwTnReC3bH5y/what-we-know-about-machine-learning-s-replication-crisis)
- [The Shift Toward Open and Reproducible AI Research (2026)](https://arxiv.org/pdf/2606.16974)
- [CORE-Bench: computational reproducibility agent benchmark](https://arxiv.org/pdf/2409.11363)

**Existing AI research agents**
- [OpenAI: PaperBench](https://openai.com/index/paperbench)
- [PaperBench paper (arXiv 2504.01848)](https://arxiv.org/abs/2504.01848v1)
- [Paper2Code / PaperCoder (arXiv 2504.17192)](https://arxiv.org/pdf/2504.17192)
- [Evaluating Sakana's AI Scientist](https://www.alphaxiv.org/abs/2502.14297v3)
- [AI Scientist in Practice (Beel et al.)](https://isg.beel.org/wp-content/uploads/2025/07/AI-Scientist-in-Practice-Reproducing-and-Evaluating-Autonomous.pdf)
- [Agent Laboratory (arXiv 2501.04227)](https://arxiv.org/pdf/2501.04227)
- [Darwin Gödel Machine (Sakana AI)](https://sakana.ai/dgm/)
- [Automated Design of Agentic Systems (ICLR 2025)](https://iclr.cc/virtual/2025/poster/28073)
- [Papers with Code shutdown and Hugging Face Trending Papers](https://hyper.ai/en/news/42900)

**AI and tools**
- [Groq pricing and free tier 2026](https://eesel.ai/blog/groq-pricing)
- [Groq: Orpheus text to speech on GroqCloud](https://groq.com/blog/canopy-labs-orpheus-tts-is-live-on-groqcloud)
- [Gemini API free tier limits 2026](https://yingtu.ai/en/blog/google-gemini-api-free-tier-limits-2026)
- [Gemini API pricing changes, April 2026](https://agentdeals.dev/gemini-api-pricing-changes)
- [Best open-source PDF to Markdown tools 2026 (Marker, Docling and others)](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026)
- [Comparison of four PDF processing methods (CUHK, 2026)](https://scrp.econ.cuhk.edu.hk/blog/analysis/2026/07/31/pdf-processing)

**Compute**
- [E2B pricing](https://www.e2b.dev/pricing)
- [Kaggle kernels command line](https://linuxcommandlibrary.com/man/kaggle-kernels)
- [Free cloud GPUs in 2026](https://gpuperhour.com/blog/free-cloud-gpus-and-credits)

**Past hackathons**
- [Recursion 5.0, RGIT Mumbai (Fetch.ai event page)](https://fetch.ai/events/recursion-5-0-rgit-mumbai)
