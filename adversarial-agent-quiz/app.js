/* ────────────────────────────────────────────────────────────────────────────
   Trace the Boundary — an Inspect code walk.

   To add a question: put an object anywhere in QUESTIONS. Nothing else needs
   editing; progress, navigation, step numbers and the summary map are all
   derived from array position — `route` and `stage` carry no numbers. Prose that
   refers to another question by "step N" does, though: grep before reordering.

   Code excerpt format — one line per source line:

       "51|         result = await sandbox().exec([...])"     ordinary line
       ">51|        result = await ...  "                     highlighted line
       "|    ..."                                             elision / blank

   The text after the first "|" is rendered verbatim (HTML-escaped), so paste
   real source in and it stays real source.

   Position is kept in the URL fragment (#04-lifecycle), so a reload resumes
   where you were. Reordering questions changes those links.
   ──────────────────────────────────────────────────────────────────────────── */

const QUESTIONS = [

  /* ─────────────────────── ORIENT ─────────────────────── */
  {
    route: "ORIENT",
    stage: "WHAT RUNS WHERE",
    title: "Read your first Inspect task",
    difficulty: 1,

    brief: `
      <p>Inspect runs <em>evaluations</em>. A <code>Task</code> bundles a
      <b>dataset</b> (the inputs), a <b>solver</b> (what drives the model), a
      <b>scorer</b> (how the answer is judged), and optionally a
      <b>sandbox</b> (somewhere the model is allowed to run commands).</p>

      <p>A <b>tool</b> is a Python function the model is allowed to call.
      Below, <code>list_files</code> is offered to the model; when the model
      asks for it, Inspect runs that function and hands the return value back
      as the tool result.</p>

      <p>Everything in this file is ordinary Python that Inspect imports and
      runs in its own process. Exactly one line reaches somewhere else. This
      walk follows that line outward, and then follows the rest of the system
      that grows around it — sandboxes, models, policy, logs, scores.</p>`,

    file: "examples/tool_use.py",
    lines: "40–51, 65–86",
    code: `
40|@tool
41|def list_files():
42|    async def execute(dir: str):
43|        """List the files in a directory.
  |
  |        Args:
  |            dir: Directory
  |        """
>51|        result = await sandbox().exec(["ls", dir])
52|        if result.success:
53|            return result.stdout
54|        else:
55|            raise ToolError(result.stderr)
  |
  |    ...
  |
65|@task
66|def bash():
  |    dataset = [ ... "Please list the files in the /usr/bin directory" ... ]
  |
77|    return Task(
78|        dataset=dataset,
79|        solver=[
80|            system_message(SYSTEM_MESSAGE),
81|            use_tools(list_files()),
82|            generate(),
83|        ],
>84|        sandbox="local",
85|        scorer=includes(),
86|    )`,

    look: `Line 51 — the one call that leaves this process — and the argument
           it forwards. Then lines 84 and 85, which name the two subsystems
           the rest of this walk is mostly about.`,

    hint: `<code>list_files</code> is a plain Python function. Ask two separate
           questions: who executes the <em>body</em> of the function, and who
           executes <code>ls</code>?`,

    question: `The model asks to call <code>list_files(dir="/usr/bin")</code>.
               Where does the <em>Python body</em> of that tool run?`,
    choices: [
      "Inside the sandbox, next to the <code>ls</code> it launches",
      "In the Inspect process on your machine; only <code>ls</code> runs in the sandbox",
      "In the model provider's infrastructure, alongside the model",
      "In a subprocess of the sandbox, created by the <code>@tool</code> decorator"
    ],
    correct: 1,

    why: [
      `The tool body is host Python. <code>sandbox().exec()</code> on line 51
       is the boundary crossing — everything above and below it is your
       process, with your files, your network and your API keys.`,
      `Notice also where <code>dir</code> came from: the <em>model</em> chose
       that string and the host passed it straight across. Trusted host code
       acting on an untrusted argument is the shape you will see in almost
       every subsystem ahead.`,
      `Keep <code>scorer=includes()</code> in mind too. It looks like a detail
       now; it is the subject of the last question in this walk.`
    ],
    label: "FOUNDATION",
    ref: "Surface review §1 — evaluation definitions are trusted host code",
    flow: "model output → host tool function → sandbox().exec → sandbox",
    takeaway: ["Orientation", "Task = data + solver + scorer + sandbox", "Tools are host code holding host authority"]
  },

  /* ─────────────────────── LOOP ─────────────────────── */
  {
    route: "LOOP",
    stage: "HOW AN AGENT TAKES ITS TURNS",
    title: "The loop is ordinary Python, and so is submitting",
    difficulty: 1,

    brief: `
      <p>The solver in step 1 was a ready-made agent. Underneath, an agent is a
      <code>while True</code> loop on your machine: ask the model for a
      response, run whatever tools it asked for, append the results to the
      conversation, ask again. Inspect's default is
      <code>react()</code>.</p>

      <p>The loop needs a way to stop. <code>react()</code> gives the model a
      tool called <code>submit</code> whose body does nothing but hand its own
      argument back. Read the tool first, then find where a submitted answer
      goes.</p>`,

    file: "src/inspect_ai/agent/_react.py",
    lines: "146–157, 231–233, 267–281",
    code: `
146|    # default submit tool
147|    @tool(name="submit")
148|    def default_submit_tool() -> Tool:
149|        async def execute(answer: str) -> ToolResult:
150|            """Submit an answer for evaluation.
  |
152|            Args:
153|              answer (str): Submitted answer
154|            """
>155|            return answer
  |
  |    ...
  |
231|                # main loop = will terminate after submit ...
232|                # or if a message or token limit is hit
233|                while True:
  |
  |                    ...
  |
267|                            if state.output.message.tool_calls:
268|                                # call tool functions
269|                                messages, output = await execute_tools(
270|                                    state.messages, tools, approval=approval
271|                                )
  |
276|                                # check for a submission
277|                                answer = submission(messages)
278|                                if answer is not None:
279|                                    # set the output to the answer for scoring
280|                                    if submit.answer_only:
>281|                                        state.output.completion = answer`,

    look: `What the submit tool's body actually does, and which field the
           submitted string is copied into.`,

    hint: `Nothing here inspects the answer. Follow the variable
           <code>answer</code> from the tool call to the line that stores it,
           and ask who chose its contents.`,

    question: `The model calls <code>submit(answer="42")</code>. What has
               happened by the time the loop breaks?`,
    choices: [
      "<code>submit</code> ran like any other tool, and its argument was copied into <code>state.output.completion</code> — the string a scorer will read later",
      "The loop stops before the call runs: <code>submit</code> is special-cased and never executed as a tool",
      "Inspect validated the answer against the sample's target and re-prompted the model until it matched",
      "The answer went into the sample's metadata; the completion stays whatever the model's last message said"
    ],
    correct: 0,

    why: [
      `<code>submit</code> is a normal tool. It is registered with the same
       <code>@tool</code> decorator as <code>bash()</code>, it is dispatched by
       the same <code>execute_tools()</code> call as every other tool, and its
       body is one line: give the argument back. What makes it special is only
       that the loop looks for its result by name.`,
      `So the eval's final answer is a string the model wrote, copied verbatim
       into <code>state.output.completion</code>. Hold on to that: the last
       question in this walk is about the code that grades exactly this field.`,
      `Two other exits exist. Without a submit tool the loop stops when the
       model stops calling tools, and either way a message, token or time limit
       can end it — which is a later question too.`
    ],
    label: "FOUNDATION",
    ref: "Surface review §17 — agent attempts and inter-attempt lifecycle",
    flow: "model asks for a tool → execute_tools runs it → submit's argument → state.output.completion",
    takeaway: ["The loop", "submit is a tool that returns its argument", "The completion is model-authored"]
  },

  /* ─────────────────────── PROVIDERS ─────────────────────── */
  {
    route: "PROVIDERS",
    stage: "WHO SUPPLIES THE ISOLATION",
    title: "Inspect defines the interface, not the box",
    difficulty: 1,

    brief: `
      <p>That task asked for <code>sandbox="local"</code>. It could have said
      <code>"docker"</code>, <code>"k8s"</code>, <code>"ec2"</code>. All of
      them satisfy one small abstract class,
      <code>SandboxEnvironment</code>, whose methods are essentially
      <code>exec()</code>, <code>read_file()</code>,
      <code>write_file()</code> and some lifecycle hooks.</p>

      <p>Providers register themselves under a name with the
      <code>@sandboxenv</code> decorator. Two ship inside Inspect
      (<code>local</code> and <code>docker</code>); the rest live in separate
      packages, and this dictionary exists only so that a missing one produces
      a helpful install message.</p>

      <p>Read this as an ownership question. If Inspect only holds a name and
      an interface, then somebody else holds the isolation.</p>`,

    file: "src/inspect_ai/util/_sandbox/registry.py",
    lines: "13–19, 24–25, 52–68",
    code: `
13|_SANDBOX_PACKAGES: dict[str, str] = {
14|    "k8s": "inspect-k8s-sandbox",
15|    "ec2": "git+https://github.com/UKGovernmentBEIS/inspect_ec2_sandbox.git",
16|    "proxmox": "git+https://github.com/UKGovernmentBEIS/inspect_proxmox_...
17|    "modal": "inspect-sandboxes",
18|    "daytona": "inspect-sandboxes",
19|}
  |
24|def sandboxenv(name: str) -> Callable[..., Type[T]]:
25|    r"""Decorator for registering sandbox environments.
  |    ...
  |
52|def registry_find_sandboxenv(envtype: str) -> type[SandboxEnvironment]:
53|    # find a matching sandboxenv_type
54|    sanxboxenv_types = registry_find(registry_match_sandboxenv(envtype))
55|    if len(sanxboxenv_types) > 0:
56|        sandboxenv_type = cast(type[SandboxEnvironment], sanxboxenv_types[0])
57|        return sandboxenv_type
58|    else:
59|        package = _SANDBOX_PACKAGES.get(envtype)
  |        ...
66|        raise ValueError(
67|            f"SandboxEnvironment type '{envtype}' not recognized.{package_msg}"
68|        )`,

    look: `What the registry actually checks before handing back a provider
           class — and what it does not check.`,

    hint: `Ask what would have to be in this file for Inspect itself to be able
           to promise containment. Is there any code here that inspects a
           provider's isolation properties?`,

    question: `Your task says <code>sandbox="docker"</code>. Which component
               decides whether the agent can reach your host filesystem?`,
    choices: [
      "The <code>SandboxEnvironment</code> base class, which enforces a common isolation floor",
      "The registry, which validates a provider before returning it",
      "The provider named in the task, plus the configuration you gave it — Inspect only defines the interface",
      "The <code>@tool</code> layer, which sanitises paths before they cross"
    ],
    correct: 2,

    why: [
      `The registry does a name lookup and returns a class. There is no
       isolation contract in the interface and nothing here inspects one, so
       the strength of the box is entirely a property of the provider you
       named and how you configured it.`,
      `That is why the security review spends a whole section on Docker
       Compose settings — <code>privileged</code>, a mounted Docker socket,
       bind mounts, host networking — rather than on this interface. A
       correctly used Inspect API with a badly configured provider is not
       contained.`,
      `It also means the trust question travels with the package: choosing
       <code>k8s</code> or <code>ec2</code> means installing third-party code
       into the host process that will run your eval.`
    ],
    label: "ARCHITECTURE",
    ref: "Surface review §3 — provider configuration and custom providers",
    flow: "sandbox=\"name\" → registry lookup → provider class → the provider's own isolation",
    takeaway: ["Providers", "Inspect owns the interface, not the box", "Isolation is the provider's and yours"]
  },

  /* ─────────────────────── HOST ─────────────────────── */
  {
    route: "HOST",
    stage: "THE MACHINE UNDER THE BOX",
    title: "Who decides how strong the container is",
    difficulty: 2,

    brief: `
      <p>The <code>docker</code> provider is the one most evals use. The shape
      of the box it creates — the image, the network, what is mounted, who the
      process runs as — comes from a Docker Compose file, and Inspect either
      finds one in your task directory or writes one for you.</p>

      <p>Read this as a precedence rule. One branch hands back a file it found;
      another builds a document from a template. Notice which of the two the
      <code>network_mode: none</code> further down belongs to.</p>`,

    file: "src/inspect_ai/util/_sandbox/docker/config.py",
    lines: "19, 26–29, 48–50, 113–120",
    code: `
19|def resolve_compose_file(parent: str = "",
  |                         project_name: str | None = None) -> str:
  |    ...
26|    # existing compose file provides all the config we need
27|    compose = find_compose_file(parent)
28|    if compose is not None:
>29|        return Path(os.path.join(parent, compose)).resolve().as_posix()
  |    ...
48|    # otherwise provide a generic python container
49|    if project_name:
>50|        return auto_compose_file(COMPOSE_GENERIC_YAML, project_name)
  |
113|COMPOSE_GENERIC_YAML = f"""{COMPOSE_COMMENT}
114|services:
115|  default:
116|    image: "aisiuk/inspect-tool-support"
117|    command: "tail -f /dev/null"
118|    init: true
>119|    network_mode: none
120|    stop_grace_period: 1s`,

    look: `Which branch returns your file untouched, and which file the
           <code>network_mode: none</code> on line 119 is part of.`,

    hint: `The comment on line 26 is doing more work than it looks like it is.
           Ask what "all the config we need" implies about anything Inspect
           might otherwise have wanted to add.`,

    question: `Your task directory contains a <code>compose.yaml</code> that asks
               for <code>network_mode: host</code> and mounts
               <code>/var/run/docker.sock</code>. What does Inspect do with it?`,
    choices: [
      "It merges its own defaults over the top, so <code>network_mode: none</code> still wins and the socket mount is dropped",
      "It uses the file as written — the strength of the box is whatever your compose file says, and the <code>network_mode: none</code> default belongs only to the file Inspect generates itself",
      "It refuses to start the sandbox, because a Docker socket mount would let the agent reach the host daemon",
      "It applies the file but warns and strips the privileged parts, such as host networking"
    ],
    correct: 1,

    why: [
      `<code>find_compose_file</code> looks in your task directory first, and
       if it finds something the function returns that path unchanged — "all
       the config we need". <code>COMPOSE_GENERIC_YAML</code> is the fallback
       for tasks that ship no configuration, and it is the only place
       <code>network_mode: none</code> appears. So the generated default is
       closed, and the configured case is entirely yours.`,
      `That makes the strength of the box <em>conditional</em> on what your
       compose file grants. <code>privileged: true</code>, host networking, a
       bind mount of a host path, running as root, and above all a mount of the
       Docker socket — each is an ordinary Docker feature, and each moves the
       boundary. The socket is the sharpest: an agent that can talk to the
       daemon can ask it for a new container with the host filesystem mounted,
       which is root on the machine.`,
      `Which introduces the machine. A container runs on something — your
       laptop, a CI runner, a Kubernetes node — and it shares that something's
       kernel, CPU, memory, disk and container runtime with the other samples
       of your eval, and possibly with other people's work. Keep it on your
       map: the Inspect process and the sandbox are two places code runs, the
       node underneath is a third, and your own browser will turn out to be a
       fourth.`
    ],
    label: "CONDITIONAL",
    ref: "Surface review §3 — provider configuration; §27 — cross-sample and shared-host surface",
    flow: "task dir → resolve_compose_file → your compose.yaml as-is, or a generated one with no network → containers on a shared host",
    takeaway: ["The host underneath", "Your compose file decides the isolation", "The generated default has no network"]
  },

  /* ─────────────────────── LIFECYCLE ─────────────────────── */
  {
    route: "LIFECYCLE",
    stage: "WHEN THE BOX EXISTS",
    title: "One sandbox per sample, bracketing the solver",
    difficulty: 2,

    brief: `
      <p>You now know who supplies a sandbox. The next question is when one
      exists. Inspect wraps each sample in an async context manager: it
      resolves the provider, creates the environment, copies in the sample's
      files, runs the sample's setup script, and only then lets the solver
      run.</p>

      <p>The <code>yield</code> in the middle of this function is the whole
      sample — every model call, every tool call, every command the agent runs
      happens inside it. Read what surrounds that <code>yield</code>.</p>`,

    file: "src/inspect_ai/_eval/task/sandbox.py",
    lines: "86–92, 99, 136–139, 147–178",
    code: `
86|async def sandboxenv_context(
87|    task_name: str,
88|    sandbox: SandboxEnvironmentSpec | None,
89|    max_sandboxes: int | None,
90|    cleanup: bool,
91|    sample: Sample,
92|) -> AsyncGenerator[None, None]:
  |    ...
99|    sandboxenv_type = registry_find_sandboxenv(sandbox.type)
  |    ...
136|        # read setup script from sample (add bash shebang if necessary)
137|        setup: bytes | None = None
138|        if sample.setup:
139|            setup = await read_sandboxenv_file(sample.setup)
  |    ...
147|        try:
148|            # initialize sandbox environment
152|            environments = await init_sandbox_environments_sample(
153|                sandboxenv_type=sandboxenv_type,
156|                files=files,
157|                setup=setup,
158|                metadata=metadata,
159|            )
  |
161|            # run sample
>162|            yield
  |    ...
168|        finally:
169|            # cleanup sandbox environment
>170|            if environments and cleanup:
  |                ...
172|                    await cleanup_sandbox_environments_sample(`,

    look: `What the <code>yield</code> on line 162 stands for, and the
           condition guarding teardown on line 170.`,

    hint: `A generator-based context manager runs the code before
           <code>yield</code> on entry and the code after it on exit. So what
           is the lifetime of the thing created on line 152?`,

    question: `An eval has 200 samples. What does the sandbox picture look like
               while it runs?`,
    choices: [
      "One sandbox for the whole task, shared by all 200 samples in turn",
      "One sandbox per epoch, reused across the samples of that epoch so the agent can carry state forward",
      "A sandbox is created lazily on the sample's first <code>sandbox().exec()</code> and lives until the process exits",
      "Each sample gets its own sandbox, created before its solver starts and destroyed when the sample ends — several alive at once, bounded by <code>max_sandboxes</code>"
    ],
    correct: 3,

    why: [
      `The context manager is entered per sample, so creation, file copying and
       the setup script all happen before the solver sees the sample, and
       teardown happens in <code>finally</code> as the sample unwinds. Samples
       run concurrently, so at any moment you have as many live sandboxes as
       the concurrency settings allow — each one a box you are assuming is
       hostile.`,
      `Two levers are visible in the signature. <code>max_sandboxes</code>
       bounds how many exist at once, which matters because the resources they
       consume are your host's. And <code>cleanup</code> is what
       <code>--no-sandbox-cleanup</code> sets to false: useful when debugging a
       failed sample, and a way to leave agent containers running after the
       eval has finished.`,
      `Note also line 139: a sample's <code>setup</code> script is content the
       task author supplies, executed inside the sandbox before the agent
       starts. It is your code, not the agent's — but it is the first thing the
       box runs, so anything it leaves behind (credentials, tokens, mounted
       paths) is there waiting when the agent arrives.`
    ],
    label: "ARCHITECTURE",
    ref: "Surface review §20 — process management, resource limits and cleanup",
    flow: "sample begins → provider creates env → files + setup script → solver runs → finally: teardown",
    takeaway: ["Lifecycle", "One sandbox per sample, brackets the solver", "Several hostile boxes at once"]
  },

  /* ─────────────────────── LOCAL ─────────────────────── */
  {
    route: "LOCAL",
    stage: "THE PROVIDER THAT ISN'T ONE",
    title: `What does <code>sandbox="local"</code> isolate?`,
    difficulty: 2,

    brief: `
      <p>Follow the previous answer through to the provider we actually asked
      for. This is the whole of <code>local</code>'s <code>exec()</code>.</p>

      <p>Read it as an operating-systems question, not a Python one: after this
      function returns, which OS boundary stands between the agent's command
      and your home directory?</p>`,

    file: "src/inspect_ai/util/_sandbox/local.py",
    lines: "83–110",
    code: `
83|        if user is not None:
84|            warnings.warn(
85|                "The 'user' parameter is ignored in LocalSandboxEnvironment. ...
86|                UserWarning,
87|            )
  |
89|        final_cwd = Path(self.directory.name if cwd is None else cwd)
90|        if not final_cwd.is_absolute():
91|            final_cwd = self.directory.name / final_cwd
  |
  |        ...
  |
>101|        result = await subprocess(
102|            args=cmd,
103|            input=input,
104|            cwd=final_cwd,
105|            env=final_env,
  |            ...
109|        )`,

    look: `Three things: what happens to <code>user</code>, what
           <code>final_cwd</code> does and does not constrain, and what
           <code>subprocess()</code> creates.`,

    hint: `A working directory decides where <em>relative</em> paths start. It
           does not change who the process is, and it does not make absolute
           paths stop working.`,

    question: `The agent runs <code>cat ~/.aws/credentials</code>. What stops it
               reading the real credentials of the user running Inspect?`,
    choices: [
      "Nothing here — it is a host subprocess running as the same user",
      "The <code>user</code> parameter, which drops privileges",
      "A container or namespace created by <code>subprocess()</code>",
      "The temporary directory the sandbox was given as its cwd"
    ],
    correct: 0,

    why: [
      `The temporary directory is a default cwd, not containment;
       <code>~</code> and every absolute path still resolve to the host
       filesystem. The <code>user</code> parameter is explicitly ignored — the
       warning on line 85 ends "Commands will run as the current user" — and
       <code>subprocess()</code> creates a
       plain child process: no namespace, same UID.`,
      `So <code>local</code> is a convenience for trusted development, and the
       review is blunt about it: <b>reject
       <code>LocalSandboxEnvironment</code> for anything claiming to contain an
       adversarial agent.</b>`,
      `Carry one consequence forward. Under <code>local</code> the agent shares
       your UID, which means it also shares your loopback ports and your
       owner-only Unix sockets. Several surfaces later in this walk are
       loopback services or socket files, and they all get easier the moment
       this provider is in play.`
    ],
    label: "OBSERVED",
    ref: "Surface review §2 — the local provider",
    flow: "agent command → LocalSandboxEnvironment.exec → host subprocess, your UID",
    takeaway: ["The local provider", "Same UID, same filesystem, same loopback", "Never for adversarial work"]
  },

  /* ─────────────────────── TRANSFER ─────────────────────── */
  {
    route: "TRANSFER",
    stage: "WHAT CROSSES THE WALL",
    title: "The three ways data moves, and their limits",
    difficulty: 3,

    brief: `
      <p>Whatever the provider, only a few things cross: a command and its
      standard input go in, standard output and an exit code come back, and
      files can be read or written by path. Everything an eval learns about the
      agent arrives through those channels.</p>

      <p>Because output can be enormous, both directions are capped. The caps
      are not the interesting part — the <em>behaviour at the cap</em> is, and
      the docstring is unusually direct about it. Read it as someone who is
      about to call <code>json.loads()</code> on the result.</p>`,

    file: "src/inspect_ai/util/_sandbox/environment.py",
    lines: "116–129, 189–192",
    code: `
116|        """Execute a command within a sandbox environment.
  |
121|        By default, each output stream (stdout and stderr) is limited to
  |        10 MiB. You can override this by setting the
  |        \`INSPECT_SANDBOX_MAX_EXEC_OUTPUT_SIZE\` environment variable ...
  |
123|        Behaviour above this limit depends on the sandbox provider. A provider may
124|        raise \`OutputLimitExceededError\`, or return only the trailing portion of
>125|        the output with the beginning discarded. Callers should therefore not
>126|        assume that returned output is complete or rely on an exception to detect
>127|        overflow. This is particularly important when parsing structured output
>128|        such as JSON. For large output, write to a file and use \`read_file()\`,
>129|        which always raises \`OutputLimitExceededError\` when the limit is exceeded.
  |
189|    async def read_file(self, file: str, text: bool = True) -> Union[str | bytes]:
190|        """Read a file from the sandbox environment.
  |
192|        By default, file size is limited to 100 MiB ... If exceeded, an
  |        \`OutputLimitExceededError\` will be raised.`,

    look: `The difference between the two channels: which one can fail
           silently, and which one is documented to always raise.`,

    hint: `"May raise, or may return only the trailing portion" is a statement
           about two providers behaving differently. Which of those two
           behaviours does a caller notice?`,

    question: `A tool runs a command whose stdout is 12 MiB of JSON, then calls
               <code>json.loads(result.stdout)</code>. What should you expect?`,
    choices: [
      "An <code>OutputLimitExceededError</code> — the limit is always enforced by raising",
      "Valid JSON: Inspect streams past the cap and only truncates the transcript copy",
      "Possibly the last 10 MiB with the start discarded, so the parse fails — or worse, parses something misleading",
      "A blocked call: <code>exec()</code> waits until the caller raises the limit"
    ],
    correct: 2,

    why: [
      `Truncation is provider-dependent and may be silent, which makes a
       success-shaped return value untrustworthy for anything you parse. The
       documented remedy is to have the command write to a file and use
       <code>read_file()</code>, which always raises at its 100 MiB cap.`,
      `The security relevance is that the agent chooses the size of the output.
       Any host-side parsing that assumes completeness is being fed by the
       thing it is measuring — the same pattern as step 1, one layer down.`,
      `Both caps are environment-tunable, so a raised limit is also a decision
       about how much attacker-chosen data your host process will hold in
       memory at once.`
    ],
    label: "OBSERVED",
    ref: "Surface review §4 — data transfer and output limits",
    flow: "agent-sized output → provider cap → possibly-truncated string → host parser",
    takeaway: ["Transfer", "exec may truncate silently; read_file raises", "The agent picks the size"]
  },

  /* ─────────────────────── TOOLS ─────────────────────── */
  {
    route: "TOOLS",
    stage: "TOOLS INSIDE A BARE CONTAINER",
    title: "How a bash session survives between calls",
    difficulty: 3,

    brief: `
      <p>Some tools need state inside the sandbox — a bash session with a live
      shell, a text editor with open files. Since <code>exec()</code> is
      one-shot, Inspect injects a self-contained binary into the container at
      <code>/var/tmp/.da7be258e003d428/inspect-sandbox-tools</code>, then talks
      to it over two layers of JSON-RPC: host to container through
      <code>exec()</code> stdin, and container-internal over a Unix socket to a
      long-running server process.</p>

      <p>That server is a privileged-ish neighbour of the agent inside the same
      container, and this is where it decides who may reach it. Read the
      comments as a statement of intent, then check the condition.</p>`,

    file: "src/inspect_sandbox_tools/src/inspect_sandbox_tools/_cli/server.py",
    lines: "141–171",
    code: `
141|    # Create server directory with permissions based on privilege level.
142|    # Root: 0o700 prevents the agent from accessing socket/logs.
143|    # Non-root: 0o777 allows any user (no privilege to escalate anyway).
>144|    directory_mode = 0o700 if os.getuid() == 0 else 0o777
145|    SERVER_DIR.mkdir(exist_ok=True)
146|    os.chmod(SERVER_DIR, directory_mode)
147|    _prepare_socket_parent()
  |
  |    ...
  |
164|    # When non-root, use permissive umask so any user can connect to the socket.
165|    # When root, directory permissions (0o700) already block unauthorized access.
>166|    old_umask = os.umask(0o111)
167|    try:
168|        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
169|        sock.bind(str(SOCKET_PATH))
170|    finally:
171|        os.umask(old_umask)`,

    look: `The condition on line 144. Then ask what the protection is when that
           condition is false — and remember what step 6 said about
           <code>local</code>.`,

    hint: `The comment gives the reasoning for the non-root case: "no privilege
           to escalate anyway". That reasoning depends on the tool server and
           the agent being the same user. When is that true?`,

    question: `The container has no root and the tool server runs as the same
               unprivileged user as the agent. What separates the agent from
               the tool server's socket and logs?`,
    choices: [
      "The 0o700 directory mode, which applies in both cases",
      "Nothing at the filesystem level — by design, since both are the same user anyway",
      "The socket is authenticated with a per-sample token",
      "The obfuscated directory name, which the agent cannot discover"
    ],
    correct: 1,

    why: [
      `When the server is root the directory is <code>0o700</code> and the
       agent is locked out. When it is not root the directory is
       <code>0o777</code> and the umask is loosened so any user can connect —
       deliberately, on the reasoning that a same-user agent could reach the
       process regardless.`,
      `So this hardening is <b>conditional on privilege separation existing in
       the container</b>. That is fine when it does. It is worth knowing when
       it does not: an agent that can speak to the socket can drive stateful
       tools directly, and tool state is what several evals grade on.`,
      `The injected path is obfuscated, which is not a control — treat it as
       tidiness. The real question is always the process identity, not the
       filename.`
    ],
    label: "CONDITIONAL",
    ref: "Surface review §6 — the injected sandbox-tools artifact",
    flow: "host exec → injected binary → unix socket → stateful tool server (same container)",
    takeaway: ["Sandbox tools", "An injected binary plus an in-container server", "Its isolation depends on a root/non-root split"]
  },

  /* ─────────────────────── CALLBACK ─────────────────────── */
  {
    route: "CALLBACK",
    stage: "THE ARROW REVERSES",
    title: "Calling host methods from inside the sandbox",
    difficulty: 3,

    brief: `
      <p>Everything so far pointed outward: the host reaches in. Some designs
      need the opposite — code running inside the sandbox that wants to call
      back into the eval. <code>sandbox_service()</code> provides it, and
      because the only reliable shared medium is the filesystem, it is built
      out of files.</p>

      <p>The host publishes a small Python client into the sandbox, the
      in-sandbox caller writes a request file, and the host polls for it and
      writes a response file back. Read the constants, then the docstring's
      usage example.</p>`,

    file: "src/inspect_ai/util/_sandbox/service.py",
    lines: "27–52, 109–121",
    code: `
27|REQUESTS_DIR = "requests"
28|RESPONSES_DIR = "responses"
>29|SERVICES_DIR = "/var/tmp/sandbox-services"
>30|SERVICES_DIR_MODE = "1777"
  |
39|POLLING_INTERVAL = 0.1
  |
44|# Output limit applied when reading a service request file. A service request
45|# payload (e.g. a model generate request carrying base64 images) can be far
  |# larger than a normal command's output ...
52|SERVICE_REQUEST_READ_OUTPUT_LIMIT = 150 * 1024**2
  |
  |    ...
  |
109|    """Run a service that is callable from within a sandbox.
110|
111|    The service makes available a set of methods to a sandbox
112|    for calling back into the main Inspect process.
  |
117|    \`\`\`python
118|    import sys
119|    sys.path.append("/var/tmp/sandbox-services/foo")
120|    import foo
121|    \`\`\``,

    look: `The directory mode on line 30, and the fact that the transport is a
           file in a well-known location that the in-sandbox side writes to.`,

    hint: `<code>1777</code> is the mode of <code>/tmp</code>: world-writable
           with a sticky bit. What does that let any process in the sandbox do,
           and what does it not let them do?`,

    question: `A service exposes a host method. Which sandbox processes can
               invoke it?`,
    choices: [
      "Only the process the service was published to, identified by PID",
      "Only processes running as the user passed to <code>sandbox_service()</code>",
      "None: the host must initiate every call, the service only responds",
      "Any process in the sandbox that can write into the requests directory — reachability is the authorisation"
    ],
    correct: 3,

    why: [
      `The requests directory is world-writable (<code>1777</code>) so that
       whichever user the agent ends up as can post requests. The sticky bit
       stops one user deleting another's files; it does not identify callers.
       Any process that can write a request file is a client.`,
      `That is a reasonable design for a cooperating in-sandbox helper, and it
       means the method surface you publish is the surface you have granted to
       the whole sandbox. Publish narrow methods, and treat their parameters as
       attacker-chosen — the reverse of step 1's lesson.`,
      `Note the raised read limit on line 52: request payloads are read with a
       150 MiB cap rather than the normal exec cap, because a bridged model
       request can carry base64 images. Step 13 is what needs that.`
    ],
    label: "BY DESIGN",
    ref: "Surface review §7 — sandbox services and inward RPC",
    flow: "in-sandbox caller → request file in /var/tmp/sandbox-services → host polls → host method runs",
    takeaway: ["Inward RPC", "A world-writable request directory", "Reachability, not identity"]
  },

  /* ─────────────────────── CHECKPOINT ─────────────────────── */
  {
    route: "CHECKPOINT",
    stage: "SANDBOX BYTES ON THE HOST",
    title: "A tar archive the agent could have written",
    difficulty: 3,

    brief: `
      <p>Long evals can checkpoint, so that a sample interrupted after four
      hours resumes instead of restarting. Part of that is copying the
      sandbox's filesystem state out to host storage, and the mechanism is the
      one you already know: build a tar inside the box, then
      <code>read_file()</code> it out.</p>

      <p>Which means host code parses an archive whose bytes came from a place
      you are treating as hostile. The comments here are unusually candid about
      that, so read them as claims to check rather than reassurance.</p>`,

    file: "src/inspect_ai/util/_checkpoint/_sandbox_restic/egress.py",
    lines: "143–149, 199–206",
    code: `
143|    tar_path = f"{_EGRESS_STAGING}/egress-{tag}.tar"
144|    # The tarball carries the full initial pack set and can
145|    # legitimately exceed the default read cap.
>146|    with override_max_read_file_size(sys.maxsize):
>147|        tar_bytes = await env.read_file(tar_path, text=False)
148|    await async_mkdir(dest_repo)
149|    await anyio.to_thread.run_sync(_extract_tar, tar_bytes, dest_repo)
  |
  |    ...
  |
199|def _extract_tar(tar_bytes: bytes, dest_repo: str) -> None:
200|    # The tarball bytes originate inside the sandbox (read via \`read_file\`),
201|    # so they are untrusted: a sandboxed agent can plant a malicious tar at
202|    # the egress staging path. \`filter="data"\` rejects absolute paths, \`..\`
203|    # traversal, and outside-pointing links, preventing host-side writes
204|    # outside \`dest_repo\` (CVE-2007-4559 class). See PEP 706.
205|    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:") as tar:
>206|        tar.extractall(dest_repo, filter="data")`,

    look: `What line 146 does to the 100 MiB cap from step 7, and what kind of
           protection <code>filter="data"</code> is.`,

    hint: `<code>filter="data"</code> is about <em>where</em> members may be
           written. Ask whether anything here is about <em>how much</em> gets
           written, or how much is held in memory first.`,

    question: `<code>filter="data"</code> is doing real work on this line. Which
               of these does it <em>not</em> stop?`,
    choices: [
      "A member with an absolute path, like <code>/etc/cron.d/evil</code>",
      "A member that escapes the destination with <code>../../</code>",
      "A tar bomb: a small archive that expands to fill the host's disk, or a huge one read into memory whole",
      "A symlink member pointing outside <code>dest_repo</code>"
    ],
    correct: 2,

    why: [
      `<code>filter="data"</code> (PEP 706) is a path-and-object filter. It
       rejects absolute paths, parent-directory traversal, links pointing
       outside the destination, and special files. Three of the four options
       are exactly what it was added to prevent.`,
      `It says nothing about size, member count, or expansion ratio — and line
       146 removes the one bound that existed by raising the read cap to
       <code>sys.maxsize</code>, so the whole archive arrives as a single
       host-side allocation before extraction even begins. The comment on 144
       explains why: a legitimate first checkpoint genuinely can be large.`,
      `Label this one carefully. The traversal defence is an existing control
       and it is real. The resource question is <em>possible</em>, not
       observed: nobody has shown a tar bomb landing here, and the path
       requires checkpointing to be enabled. Worth a test, not an alarm.`
    ],
    label: "POSSIBLE",
    ref: "Surface review §16 — checkpoint export, storage, restore and resume",
    flow: "agent-writable staging path → read_file with the cap lifted → host tarfile → extractall",
    takeaway: ["Checkpoints", "Sandbox tar bytes reach a host parser", "filter=data bounds paths, not size"]
  },

  /* ─────────────────────── MODELS ─────────────────────── */
  {
    route: "MODELS",
    stage: "WHERE THE CREDENTIALS LIVE",
    title: "The model layer, and the key that never moves",
    difficulty: 3,

    brief: `
      <p>Models are plug-ins in the same way sandboxes are: a provider
      subclasses <code>ModelAPI</code>, is registered under a name, and
      declares which environment variables might hold its key through
      <code>api_key_vars</code>.</p>

      <p>The constructor does one more thing that matters. Before the provider
      is ever used, Inspect gives a <b>hook</b> the chance to substitute the
      key — that is how an organisation routes every eval through a key proxy
      without touching provider code. Read who ends up holding the
      credential.</p>`,

    file: "src/inspect_ai/model/_model.py",
    lines: "202–260",
    code: `
202|    def __init__(
203|        self,
204|        model_name: str,
205|        base_url: str | None = None,
206|        api_key: str | None = None,
207|        api_key_vars: list[str] = [],
208|        config: GenerateConfig = GenerateConfig(),
209|    ) -> None:
  |        ...
220|        self.model_name = model_name
222|        self.api_key = api_key
223|        self.api_key_vars = api_key_vars
>229|        self._apply_api_key_overrides()
  |
231|    def _apply_api_key_overrides(self) -> None:
>232|        from inspect_ai.hooks._hooks import has_api_key_override, override_api_key
  |
234|        # apply api key override
235|        api_key = self.api_key
236|        for key in self.api_key_vars:
  |            ...
246|                value = os.environ.get(key, None)
247|                if value is not None:
248|                    override = override_api_key(key, value)
249|                    if override is not None:
>250|                        os.environ[key] = override`,

    look: `Which process's memory and environment this code touches — and
           whether any of it is ever handed to a sandbox.`,

    hint: `Ask where <code>ModelAPI</code> instances live. Is there any path in
           this file that writes a key into the sandbox filesystem or its
           environment?`,

    question: `An agent running inside the sandbox needs to call a model. Where
               does the API key for that call live?`,
    choices: [
      "In the host Inspect process only — resolved from <code>api_key_vars</code> or a hook, and never sent across",
      "In the sandbox's environment, injected when the container starts",
      "In the eval log, so that runs can be reproduced",
      "In the provider package's own config file on disk"
    ],
    correct: 0,

    why: [
      `Keys resolve host-side, into the host process's own environment and
       objects. Nothing here crosses into the sandbox — and that is the whole
       design intent: an agent should be able to <em>use</em> inference without
       ever holding a credential.`,
      `The hook indirection is worth recognising, because it means the key your
       provider ends up with may not be the one in your shell. It also means a
       registered hook sees every key the eval touches — host extension code is
       trusted code, exactly as in step 1.`,
      `The other half of this subsystem points the opposite way: model
       <em>output</em> is attacker-influenced text that your host code, your
       parsers, your scorers and your browser will all handle later. Step 13
       shows how an in-sandbox agent gets to make those calls at all.`
    ],
    label: "EXISTING CONTROL",
    ref: "Surface review §25 — secrets, credentials and sensitive configuration",
    flow: "api_key_vars + hook → host-side key → provider request → completion returns as untrusted text",
    takeaway: ["The model layer", "Providers are plug-ins; keys stay host-side", "Completions are untrusted input"]
  },

  /* ─────────────────────── HOOKS ─────────────────────── */
  {
    route: "HOOKS",
    stage: "CODE YOU DIDN'T WRITE, IN YOUR PROCESS",
    title: "Extensions are host code, loaded from the environment",
    difficulty: 4,

    brief: `
      <p>Step 3 showed providers arriving as installed packages. The same
      mechanism carries observers. A package can subclass <code>Hooks</code>,
      decorate it with <code>@hooks</code>, and receive every event of every
      eval: run start, sample start, each model call, scoring, run end.</p>

      <p>The registration is what to look at. Nothing in an eval asks for these
      — importing the module is the whole opt-in. And one of the methods a hook
      may implement is not an observer at all.</p>`,

    file: "src/inspect_ai/hooks/_hooks.py · _startup.py",
    lines: "602–614, 645–653 · 62",
    code: `
602|    def override_api_key(self, data: ApiKeyOverride) -> str | None:
603|        """Optionally override an API key.
  |
605|        When overridden, this method may return a new API key value which
  |        will be used in place of the original one during the eval.
  |        """
614|        return None
  |
  |    ...
  |
645|        # Instantiate an instance of the Hooks class.
>646|        hook_instance = hook_type()
647|        hook_name = registry_name(hook_instance, name)
>648|        registry_add(
649|            hook_instance,
650|            RegistryInfo(
651|                type="hooks", name=hook_name,
  |                metadata={"description": description}
652|            ),
653|        )
  |
  |    # _startup.py — the one env var in this area
62|    required_hooks_env_var = os.environ.get("INSPECT_REQUIRED_HOOKS", "")`,

    look: `When the hook instance is created, what
           <code>override_api_key()</code> is able to change, and what
           <code>INSPECT_REQUIRED_HOOKS</code> is for.`,

    hint: `Read the env var's name literally. Does it say which hooks are
           <em>allowed</em>, or which must be <em>present</em>? Those are
           different policies.`,

    question: `A package installed for an unrelated reason registers a hook.
               What does it get?`,
    choices: [
      "Nothing until the eval opts in — hooks must be listed in the task or on the command line",
      "Everything the Inspect process has. It is instantiated on import, sees every event, and may replace the API key used for model calls",
      "A read-only event stream: hooks observe and may write files, but cannot alter the eval",
      "Only what <code>INSPECT_REQUIRED_HOOKS</code> permits, which acts as an allowlist"
    ],
    correct: 1,

    why: [
      `The decorator runs at import time: it constructs the hook and puts the
       instance in the registry, where it stays for the life of the process.
       There is no per-eval opt-in, and a hook is ordinary host code — same
       filesystem, same network, same credentials as your task.`,
      `<code>override_api_key()</code> makes the point sharply. A hook may
       return a different key, and the model layer will use it. That exists for
       good reasons — key vending, proxies, per-team quotas — and it is
       precisely the shape of thing you want to know is installed.`,
      `<code>INSPECT_REQUIRED_HOOKS</code> is a presence check, not an
       allowlist: it fails the run if a named hook is <em>missing</em>. Useful
       for making sure an org's audit hook cannot be skipped; no help at all
       against a hook you didn't want. Your control here is the environment
       itself — which packages are installed in the venv running the eval.`
    ],
    label: "BY DESIGN",
    ref: "Surface review §1 (trusted host code), §28 (hooks and downstream consumers)",
    flow: "pip install → module import → @hooks registers an instance → every event, and the API key",
    takeaway: ["Extensions", "Hooks register on import, not per eval", "The venv is the trust boundary"]
  },

  /* ─────────────────────── BRIDGE ─────────────────────── */
  {
    route: "BRIDGE",
    stage: "A DELIBERATE OPENING",
    title: "How an agent in the container reaches your models",
    difficulty: 4,

    brief: `
      <p>Suppose the thing you want to evaluate is somebody else's agent — a
      program that speaks the OpenAI or Anthropic HTTP API and knows nothing
      about Inspect. The <b>sandbox agent bridge</b> lets it run unmodified:
      Inspect starts a proxy <em>inside the container</em> that accepts those
      APIs and forwards each request to the current Inspect model.</p>

      <p>You point the agent at it with an environment variable. Read the
      docstring for the contract, and the proxy's <code>start()</code> for what
      is actually listening.</p>`,

    file: "src/inspect_ai/agent/_bridge/sandbox/bridge.py · .../_agent_bridge/proxy.py",
    lines: "54, 64–72 · 52, 499–503",
    code: `
  |# src/inspect_ai/agent/_bridge/sandbox/bridge.py
>54|    port: int = 13131,
  |    ...
64|    """Sandbox agent bridge.
  |
66|    Provide Inspect integration for agents running inside sandboxes. Runs
67|    a proxy server in the container that provides REST endpoints for the
  |    OpenAI Completions API, OpenAI Responses API, Anthropic API, and Google
  |    API. This proxy server runs on port 13131 and routes requests to the
  |    current Inspect model provider.
  |
70|    You should set \`OPENAI_BASE_URL=http://localhost:13131/v1\` ...
  |
  |# src/inspect_sandbox_tools/src/.../_agent_bridge/proxy.py
>52|    def __init__(self, host: str = "127.0.0.1", port: int = 8000) -> None:
  |    ...
499|    async def start(self) -> None:
>500|        self.server = await asyncio.start_server(
501|            self._handle_client, self.host, self.port
502|        )`,

    look: `Which side of the wall the listener is on, and what a client has to
           present in order to be served.`,

    hint: `Compare this with step 9. Both are openings the evaluator chose to
           create. Ask the same question of each: what distinguishes an
           authorised caller from any other process that can reach the
           endpoint?`,

    question: `The bridge is running. Which processes can submit model requests
               through it, and at whose expense?`,
    choices: [
      "Only the bridged agent, which is issued a token at startup",
      "Only processes started by Inspect's own solver code",
      "Any host process, since the proxy binds the host's loopback interface",
      "Any process in that container that can reach loopback port 13131 — billed to your provider account"
    ],
    correct: 3,

    why: [
      `The proxy listens on the container's loopback and serves whoever
       connects. There is no caller identity — reachability is the
       authorisation, the same property as the service directory in step 9.
       Requests are real inference on your keys and your budget.`,
      `This is a granted opening, not a flaw: you cannot bridge an unmodified
       agent without giving it an endpoint. What matters is knowing what the
       grant includes — inference spend, and a channel whose traffic is shaped
       by the agent.`,
      `Now recall step 6. Under the <code>local</code> provider, "the
       container's loopback" is <em>your</em> loopback and the agent shares your
       UID, so the audience for port 13131 is every process on your machine
       running as you.`
    ],
    label: "BY DESIGN",
    ref: "Surface review §8 — the model bridge HTTP proxy",
    flow: "in-container agent → localhost:13131 → proxy → host model provider → your account",
    takeaway: ["The bridge", "An in-container endpoint onto your models", "Reachable means authorised"]
  },

  /* ─────────────────────── ROUTING ─────────────────────── */
  {
    route: "ROUTING",
    stage: "READ IT LIKE AN ATTACKER",
    title: "Which model actually serves the request?",
    difficulty: 4,

    brief: `
      <p>A bridge request names a model, and that name is a string chosen by
      the agent. This function turns it into a <code>Model</code>. It is nine
      lines and it is the first place in this walk where the answer depends on
      reading control flow precisely rather than on understanding a
      subsystem.</p>

      <p>Along the way it introduces two core Inspect concepts:
      <b>aliases</b> (a map from request names to models) and <b>roles</b>
      (named slots like <code>grader</code> that an eval binds to models on the
      command line).</p>

      <p>Suppose you write
      <code>sandbox_agent_bridge(model="inspect/openai/gpt-4o-mini")</code>,
      intending everything to go to the cheap model. Trace an agent request for
      the bare name <code>"inspect"</code>.</p>`,

    file: "src/inspect_ai/agent/_bridge/util.py",
    lines: "366–384",
    code: `
366|def resolve_inspect_model(
367|    model_name: str,
368|    model_aliases: dict[str, str | Model] | None = None,
369|    fallback_model: str | None = None,
370|) -> Model:
>371|    if model_aliases and model_name in model_aliases:
372|        return get_model(model_aliases[model_name])
  |
374|    if fallback_model is not None:
>375|        if model_name != "inspect" or not fallback_model.startswith("inspect/"):
376|            model_name = fallback_model
  |
>378|    if model_name == "inspect":
379|        return get_model()
  |
381|    model_name = model_name.removeprefix("inspect/")
382|    if model_name in model_roles():
383|        return get_model(role=model_name)
384|    return get_model(model_name)`,

    look: `Line 375 with <code>model_name == "inspect"</code> and
           <code>fallback_model == "inspect/openai/gpt-4o-mini"</code>.
           Evaluate both sides of the <code>or</code> before you decide.`,

    hint: `Both halves of the condition are false in this case, so the body does
           not run. Follow <code>model_name</code> to the next
           <code>if</code>.`,

    question: `With that fallback configured, an agent requests the model name
               <code>"inspect"</code>. Which model serves it?`,
    choices: [
      "The eval's own active model: the fallback is skipped for the exact name <code>\"inspect\"</code>",
      "<code>openai/gpt-4o-mini</code> — the fallback, as configured",
      "Whichever model is first in <code>model_roles()</code>",
      "The request fails, because <code>\"inspect\"</code> is not a resolvable model name"
    ],
    correct: 0,

    why: [
      `<code>model_name != "inspect"</code> is false, and
       <code>not fallback_model.startswith("inspect/")</code> is also false, so
       line 376 is skipped and <code>model_name</code> stays
       <code>"inspect"</code> — which line 378 resolves to
       <code>get_model()</code>, the eval's active model.`,
      `The docstring agrees with the code: the fallback is "for requests that
       don't use <code>inspect</code>". So this is documented behaviour, not a
       defect. The lesson is about how you read it — <b>a
       <code>model=</code> setting is a default for unrecognised names, not a
       cap on what the agent may reach.</b>`,
      `Two other lines are worth remembering: aliases are consulted first and
       win outright, and an unprefixed name that matches a <em>role</em>
       resolves to that role's model. If you want a spending or capability
       limit, express it as a limit (step 17), not as a name.`
    ],
    label: "BY DESIGN",
    ref: "Surface review §9 — model resolution over the bridge",
    flow: "agent-chosen name → aliases → fallback (conditionally) → roles → active model",
    takeaway: ["Model resolution", "Aliases first, fallback only sometimes", "A default is not a restriction"]
  },

  /* ─────────────────────── MCP ─────────────────────── */
  {
    route: "MCP",
    stage: "TOOLS FROM SOMEWHERE ELSE",
    title: "Tool definitions fetched at runtime",
    difficulty: 4,

    brief: `
      <p>So far every tool has been a Python function in your repository. MCP —
      the Model Context Protocol — lets an eval attach tools from a separate
      server instead: a local process, or something over HTTP. Inspect wraps
      each one as a normal <code>Tool</code> so the loop from step 2 doesn't
      know the difference.</p>

      <p>Look at where the wrapper gets the tool's identity. The
      <code>execute</code> body is long; the two short pieces below are the
      whole point.</p>`,

    file: "src/inspect_ai/tool/_mcp/_local.py",
    lines: "210–223, 294–304",
    code: `
210|    @override
211|    async def tools(self) -> list[Tool]:
212|        if self._cached_tool_list:
213|            mcp_tools = self._cached_tool_list
214|        else:
215|            async with self._client_session() as session:
216|                # get the underlying tools on the server
217|                with trace_action(logger, "MCPServer", f"list_tools ...
>218|                    mcp_tools = (await session.list_tools()).tools
219|                self._cached_tool_list = mcp_tools
  |
221|        return [
222|            self._tool_def_from_mcp_tool(mcp_tool).as_tool()
  |            for mcp_tool in mcp_tools
223|        ]
  |
  |    ...
  |
294|        # get parameters (fill in missing ones)
295|        parameters = ToolParams.model_validate(tool_input_schema(mcp_tool))
  |        ...
299|        return ToolDef(
300|            execute,
>301|            name=mcp_tool.name,
>302|            description=mcp_tool.description,
>303|            parameters=parameters,
304|        )`,

    look: `Which parts of the tool the server supplies, and where that text ends
           up once the tool is handed to the model.`,

    hint: `A tool's description is written into the model's context so it knows
           when to call it. Who wrote this one?`,

    question: `An eval attaches a third-party MCP server. What has that server
               gained?`,
    choices: [
      "Nothing beyond executing calls: names, descriptions and schemas are declared in the eval and validated against the server",
      "Only the ability to return tool results, which are already treated as untrusted",
      "A write into the model's context on every sample — it names the tools, writes their descriptions, and defines their parameters",
      "Access to the sandbox, since MCP tools run inside the agent's container"
    ],
    correct: 2,

    why: [
      `<code>list_tools()</code> is a request to the server, and the answer
       becomes the <code>ToolDef</code>: name, description, parameter schema.
       Tool descriptions are prompt text — the model reads them to decide what
       to call — so whoever runs the server writes part of every prompt in your
       eval. That is the prompt-injection channel, before any tool has been
       called.`,
      `It also complicates the control you meet in the next question. Approval
       policies and allowlists are written against tool <em>names</em>, and
       these names arrive at runtime from a third party, cached per session. A
       policy written before the fetch cannot enumerate them.`,
      `None of this makes MCP unsafe to use; it makes the server a trusted
       component. The question to ask of one is the same you'd ask of a
       package: who publishes it, and would you notice if its answers
       changed?`
    ],
    label: "CONDITIONAL",
    ref: "Surface review §15 — MCP clients, servers, tools and sampling",
    flow: "server list_tools → name + description + schema → ToolDef → model context",
    takeaway: ["MCP", "The server names and describes the tools", "Descriptions are prompt text"]
  },

  /* ─────────────────────── CONTROL ─────────────────────── */
  {
    route: "CONTROL",
    stage: "WHERE POLICY LIVES",
    title: "Approval and limits, the two real chokepoints",
    difficulty: 4,

    brief: `
      <p>Inspect has two places where an eval can say no. <b>Limits</b>
      (<code>token</code>, <code>cost</code>, <code>message</code>,
      <code>turn</code>, <code>time</code>, <code>working</code>) bound
      consumption. <b>Approval</b> is finer: every tool call passes through
      <code>apply_tool_approval()</code> before it executes, and an approver
      returns <code>approve</code>, <code>modify</code>, <code>reject</code>,
      <code>terminate</code> or <code>escalate</code>.</p>

      <p>Notice what the approver receives. It is the only component in this
      walk that sees a call's <em>arguments</em> together with the whole
      conversation that produced them — which makes it the natural home for
      anything argument-shaped.</p>`,

    file: "src/inspect_ai/approval/_apply.py",
    lines: "24–63",
    code: `
24|async def apply_tool_approval(
25|    message: str,
26|    call: ToolCall,
27|    viewer: ToolCallViewer | None,
>28|    history: list[ChatMessage],
29|) -> tuple[bool, Approval | None]:
30|    approver = _tool_approver.get(None)
31|    if approver:
  |        ...
48|        # call approver (approvers which use model inference — e.g. LLM monitors —
49|        # shouldn't have that inference charged to the agent's own budget)
>50|        with suspend_token_limit(), suspend_turn_limit():
51|            approval = await approver(
52|                message=message,
>53|                call=call,
54|                view=view,
55|                history=history,
56|            )
  |
58|        # process decision
59|        match approval.decision:
60|            case "approve" | "modify":
61|                return True, approval
62|            case "reject":
63|                return False, approval`,

    look: `<code>call</code> on line 53 — a function name plus its arguments —
           and the fact that this runs before the tool body does.`,

    hint: `Think about a grant expressed as a list of names. What does an
           allowlist of names know about the strings passed to them?`,

    question: `You give a bridged agent a host tool <code>read_host_file</code>
               and allowlist that one name. Where does the policy about
               <em>which paths</em> it may read have to live?`,
    choices: [
      "In the allowlist — naming a tool implies its arguments are validated",
      "In the tool's own implementation, or in an approver that inspects the arguments",
      "In the sandbox provider, which rewrites paths crossing the boundary",
      "Nowhere: bridged tool arguments are sanitised before dispatch"
    ],
    correct: 1,

    why: [
      `An allowlist answers "which functions may be called". It says nothing
       about arguments. The two components that can see arguments are the tool
       body and the approver, so path, URL and command policy has to be
       written in one of those.`,
      `This applies to every inward grant you have met: a bridged host tool, an
       MCP server exposed to the sandbox, a published sandbox service method.
       Granting them is a legitimate evaluator decision — the point is
       knowing which layer holds the policy, because by default no layer
       does.`,
      `Two practical notes. <code>suspend_token_limit()</code> on line 50 means
       an LLM-monitor approver's own inference is not billed to the agent's
       budget, so monitoring does not eat the thing it monitors. And approval
       is per-call and synchronous, which makes it the only chokepoint that can
       stop an action rather than merely record it.`
    ],
    label: "EXISTING CONTROL",
    ref: "Surface review §10 — bridged host tools; attack types §4 — capability-policy bypass",
    flow: "tool call + history → approver decision → tool body runs, or does not",
    takeaway: ["Policy", "Approval sees arguments; allowlists see names", "Grants need a layer that holds policy"]
  },

  /* ─────────────────────── LIMITS ─────────────────────── */
  {
    route: "LIMITS",
    stage: "THE OTHER HALF OF THE CONTROL PLANE",
    title: "Eight kinds of budget, and where they raise",
    difficulty: 4,

    brief: `
      <p>Approval answers "may this happen". Limits answer "how much of this,
      and for how long" — and they are the control that works when nobody is
      watching. The type list in the error is the whole taxonomy, so start
      there.</p>

      <p>Then read the <code>time_limit()</code> docstring, which is explicit
      about something easy to get wrong: where the exception comes out.</p>`,

    file: "src/inspect_ai/util/_limit.py",
    lines: "55–63, 834–848",
    code: `
55|    def __init__(
56|        self,
57|        type: Literal[
>58|            "message", "time", "working", "token", "turn", "cost",
  |            "operator", "custom"
59|        ],
  |        *,
61|        value: float,
62|        limit: float,
  |        ...
  |
  |    ...
  |
834|def time_limit(limit: float | None) -> _TimeLimit:
835|    """Limits the wall clock time which can elapse.
  |
841|    When a limit is exceeded, the code block is cancelled and a ...
842|    raised.
  |
844|    Uses anyio's cancellation scopes meaning that the operations within ...
845|    manager block are cancelled if the limit is exceeded. The ...
>846|    therefore raised at the level that the \`time_limit()\` context ...
>847|    not at the level of the operation which caused the limit to be ...
>848|    to \`generate()\`). Ensure you handle \`LimitExceededError\` at the ...`,

    look: `Which resources have their own limit type, and which line in the
           stack sees the error when a time limit fires.`,

    hint: `An agent can be extremely busy without generating a single token.
           Go down the list of eight and ask which ones are counting while
           that happens.`,

    question: `An agent spends an hour in tool calls — long
               <code>bash</code> commands, almost no model traffic. Which
               limits are counting, and where does the error surface?`,
    choices: [
      "Token and cost limits: sandbox time is billed through the model layer",
      "The turn limit, since one turn is open for the whole hour",
      "None: limits only bound model calls, so the sandbox needs its own timeout",
      "Time and working limits — and the error is raised where the limit context manager was opened, not at the <code>exec()</code> that consumed the hour"
    ],
    correct: 3,

    why: [
      `The eight types measure different things, and an agent working inside
       the sandbox moves only some of the meters. Token, cost, message and turn
       limits watch model traffic; time is wall clock; working time is wall
       clock minus waiting (rate-limit backoff, queueing on a semaphore),
       which is what you want when the question is "how much work has this
       done".`,
      `The docstring's warning matters when you write your own harness. A time
       limit is an anyio cancel scope, so the exception appears at the
       <code>with</code> statement, not at the awaited call deep inside — catch
       it where you opened it. Limits also nest: each context manager adds a
       node, so an inner agent-scoped limit can fire without ending the
       sample.`,
      `Read this beside the previous question: approval is a policy about
       individual actions, limits are a bound on aggregate consumption.
       Resource exhaustion is not something an approval policy can express, and
       an unattended eval has only the second kind of control.`
    ],
    label: "EXISTING CONTROL",
    ref: "Surface review §20 — resource limits; attack types §14 — resource exhaustion",
    flow: "context manager opens → usage recorded per type → limit exceeded → raised at the scope you opened",
    takeaway: ["Limits", "Eight budget types, nested by scope", "The error lands at the with-statement"]
  },

  /* ─────────────────────── RECORD ─────────────────────── */
  {
    route: "RECORD",
    stage: "WHAT THE LOG CAN PROVE",
    title: "The transcript, and what it leaves out",
    difficulty: 4,

    brief: `
      <p>Everything Inspect does becomes a typed event: model calls, tool
      calls, approvals, errors, and each sandbox action. Recorders write them
      into the <code>.eval</code> log. This is the artifact your results, your
      reproductions and any incident review all rest on.</p>

      <p>Read the sandbox event closely. Two of its fields carry a docstring
      that changes what the log can be used for.</p>`,

    file: "src/inspect_ai/event/_sandbox.py",
    lines: "10–38",
    code: `
10|class SandboxEvent(BaseEvent):
11|    """Sandbox execution or I/O"""
  |
16|    action: Literal["exec", "read_file", "write_file"]
17|    """Sandbox action"""
  |
19|    cmd: str | None = Field(default=None)
20|    """Command (for exec)"""
  |
25|    file: str | None = Field(default=None)
26|    """File (for read_file and write_file)"""
  |
>28|    input: str | None = Field(default=None)
>29|    """Input (for cmd and write_file). Truncated to 100 lines."""
  |
31|    result: int | None = Field(default=None)
32|    """Result (for exec)"""
  |
>34|    output: str | None = Field(default=None)
>35|    """Output (for exec and read_file). Truncated to 100 lines."""
  |
37|    completed: UtcDatetime | None = Field(default=None)`,

    look: `Who writes this record, and what "truncated to 100 lines" means for
           a command whose interesting output is on line 400.`,

    hint: `Ask two separate questions. Is the record's <em>provenance</em>
           trustworthy? And is it <em>complete</em>? They have different
           answers.`,

    question: `A month later you need to know exactly what the agent ran and saw.
               What does the transcript give you?`,
    choices: [
      "A host-written record of each action — trustworthy about what happened, but with input and output truncated",
      "The agent's own account of what it did, which you have to corroborate",
      "A complete byte-for-byte record: every command, its full stdin and stdout",
      "Nothing about sandbox activity unless you enabled extra logging"
    ],
    correct: 0,

    why: [
      `The events are written by the host as it performs each action, so their
       provenance is sound: they are observations, not agent claims. The agent
       cannot forge a <code>SandboxEvent</code> — it can only cause one.`,
      `Completeness is the weaker property. Truncation at 100 lines makes the
       log an index rather than an archive. If an analysis or a dispute depends
       on full output, the eval has to capture it deliberately — a file in the
       sandbox, read and stored on purpose.`,
      `Combined with step 7, this is a useful habit: ask of any recorded value
       both "who wrote this" and "is this all of it". They are the questions
       that separate an audit trail from a summary.`
    ],
    label: "EXISTING CONTROL",
    ref: "Surface review §21 — transcript construction and event attribution",
    flow: "host action → typed event → recorder → .eval log",
    takeaway: ["The record", "Host-written events, so provenance holds", "Truncated, so completeness does not"]
  },

  /* ─────────────────────── VIEWER ─────────────────────── */
  {
    route: "VIEWER",
    stage: "WHO CAN REACH THE VIEWER",
    title: "Serving logs, and the refusal that guards it",
    difficulty: 4,

    brief: `
      <p><code>inspect view</code> starts a local HTTP server that reads your
      logs and renders them in your browser. It is the one part of Inspect that
      is a web application, so it carries web-application questions: who can
      reach it, and whose text is it rendering.</p>

      <p>The first question has an explicit answer in the code. Loopback needs
      nothing; anything wider is refused unless you have configured
      authorisation or knowingly waived it.</p>`,

    file: "src/inspect_ai/_view/network.py",
    lines: "97–117",
    code: `
97|    authorization = authorization or None
>98|    if not loopback and authorization is None
>  |            and not unsafe_allow_unauthenticated:
99|        extra = (
100|            " Wildcard binds also require --trusted-origin or --trusted-host."
101|            if wildcard
102|            else ""
103|        )
>104|        raise ViewerNetworkPolicyError(
105|            f"Refusing to expose Inspect View on {bind_host} without request "
106|            "authorization. Configure INSPECT_VIEW_AUTHORIZATION_TOKEN behind "
107|            "an authenticated proxy, or pass --unsafe-allow-unauthenticated "
108|            f"to acknowledge unauthenticated network access.{extra} "
109|            f"See {_VIEW_DOCS_URL}."
110|        )
  |
112|    if wildcard and not trusted_hosts and not trusted_origins:
113|        raise ViewerNetworkPolicyError(
114|            f"Refusing wildcard bind {bind_host} without an explicit trusted "
115|            "origin or host. Configure --trusted-origin or --trusted-host. "
116|            f"See {_VIEW_DOCS_URL}."
117|        )`,

    look: `The three conditions on line 98, and the fact that the default
           outcome of getting them wrong is an exception rather than a
           warning.`,

    hint: `This is a control, not a hole. The interesting part is what it
           protects and what it cannot protect — the server's reachability is
           one thing, the content it renders is another.`,

    question: `On a shared machine you run <code>inspect view --host 0.0.0.0</code>
               with no token configured. What happens?`,
    choices: [
      "It serves on all interfaces; log access is read-only so this is safe",
      "It serves and prints a warning about unauthenticated access",
      "It refuses to start, naming the token to set or the flag that waives the requirement",
      "It quietly falls back to binding <code>127.0.0.1</code>"
    ],
    correct: 2,

    why: [
      `It raises <code>ViewerNetworkPolicyError</code>. Non-loopback binds
       require either <code>INSPECT_VIEW_AUTHORIZATION_TOKEN</code> or an
       explicit <code>--unsafe-allow-unauthenticated</code>, and a wildcard
       bind additionally requires a trusted origin or host. The review labels
       things like this an <b>existing control</b>, and recognising them is
       half of reading a security review well.`,
      `The part the network policy cannot address is the content. A viewer
       renders model output, tool arguments and command output — text the agent
       authored — inside an operator's browser session. That is the same
       untrusted-input question as step 7, arriving at a rendering engine
       instead of a parser. That is the next step.`,
      `The same reasoning applies to the control server that lets sandboxes
       talk to a running eval: loopback is the boundary, and the moment
       something widens it, identity has to come from somewhere else.`
    ],
    label: "EXISTING CONTROL",
    ref: "Surface review §23 — viewer backend, filesystem access and API",
    flow: "log files → local HTTP server → operator's browser rendering agent-authored text",
    takeaway: ["The viewer", "Non-loopback binds are refused without a token", "It still renders agent-authored text"]
  },

  /* ─────────────────────── BROWSER ─────────────────────── */
  {
    route: "BROWSER",
    stage: "CODE IN YOUR OWN BROWSER",
    title: "What stops agent-authored markup from executing",
    difficulty: 5,

    brief: `
      <p>The previous step ended on content rather than reachability. A model's
      messages are markdown, and the viewer turns markdown into HTML in your
      browser — so a string the agent wrote reaches a rendering engine that
      runs JavaScript inside your session.</p>

      <p>Two files decide what happens to it. The Python server chooses the
      response headers; the frontend it serves chooses what markup survives.
      Read both and work out which one is actually holding the line.</p>`,

    file: "src/inspect_ai/_view/network.py · .../react/src/components/renderedHtmlSanitizer.ts",
    lines: "232–236 · 107–119, 142–152",
    code: `
  |# src/inspect_ai/_view/network.py
232|        async def send_with_security_headers(message: Message) -> None:
233|            if message["type"] == "http.response.start":
234|                headers = MutableHeaders(scope=message)
>235|                headers.append("Content-Security-Policy",
>  |                               "frame-ancestors 'none'")
236|                headers["X-Frame-Options"] = "DENY"
  |
  |# .../react/src/components/renderedHtmlSanitizer.ts
107|const PURIFY_CONFIG: Config = {
108|  ADD_ATTR: [...MATHJAX_ATTRS, "target"],
114|  ALLOW_DATA_ATTR: true,
115|  ALLOW_UNKNOWN_PROTOCOLS: false,
116|  FORBID_ATTR: ["srcdoc", "srcset"],
>117|  FORBID_TAGS: FORBIDDEN_TAGS,
118|  USE_PROFILES: { html: true, mathMl: true, svg: true },
119|};
  |
142|export const sanitizeRenderedHtml = (html: string): string => {
  |    ...
147|  const purifier = getPurify();
148|  if (!purifier) {
149|    return escapeHtmlCharacters(html);
150|  }
  |
>152|  return purifier.sanitize(html, PURIFY_CONFIG);`,

    look: `Which of the two files removes dangerous markup, and how narrow the
           policy on line 235 is — what it governs, and what it says nothing
           about.`,

    hint: `Read the header literally. <code>frame-ancestors</code> decides who
           may put your page in a frame. Ask which directive would be needed to
           govern scripts, and whether you can see it.`,

    question: `A model's answer contains
               <code>&lt;img src=x onerror=alert(1)&gt;</code> and you open that
               sample in the viewer. Which layer stops it running?`,
    choices: [
      "The header on line 235 — the Content-Security-Policy blocks inline event handlers",
      "The log format, which stores message content HTML-escaped when the eval is written",
      "Nothing does, which the review records as an observed vulnerability in the viewer",
      "The frontend sanitiser — agent-authored HTML goes through DOMPurify with an allowlist config before it reaches the DOM, while the server's policy only forbids framing"
    ],
    correct: 3,

    why: [
      `<code>sanitizeRenderedHtml</code> is the gate every rendering path goes
       through, and <code>PURIFY_CONFIG</code> is an allowlist:
       <code>FORBID_TAGS</code> covers <code>script</code>,
       <code>iframe</code>, <code>form</code>, <code>object</code>,
       <code>embed</code> and the SVG animation tags, unknown protocols are
       refused, and <code>onerror</code> is simply not an allowed attribute.
       Hooks in the same file go further, stripping unsafe URL attributes and
       filtering CSS declarations. The review labels this an <b>existing
       control</b>.`,
      `Note what the server does <em>not</em> do. The only policy it sends is
       <code>frame-ancestors 'none'</code>, plus <code>X-Frame-Options</code> —
       together they stop another page framing your viewer, and nothing else.
       There is no <code>script-src</code>, so the CSP is not a second line of
       defence behind the sanitiser; the sanitiser is the line. Line 149 is the
       other half of that posture: with no <code>window</code> to purify
       against, the text is escaped rather than rendered.`,
      `Then generalise past execution. Your browser is a place code runs, it
       holds your session, and it is on your network — and it is displaying a
       document the agent partly wrote. Sanitisation stops the markup from
       executing; it does nothing about being misled by the content. A
       plausible-looking traceback, a transcript that reads as though a step
       succeeded, output shaped to survive a skim: reading a log is also an
       adversarial setting, and the review treats deceiving the operator as a
       surface of its own.`
    ],
    label: "EXISTING CONTROL",
    ref: "Surface review §24 — viewer frontend and rendering of agent-authored content",
    flow: "agent text → log → viewer server (framing headers only) → DOMPurify allowlist → your DOM",
    takeaway: ["Your browser", "DOMPurify's allowlist is the control", "The server's CSP only forbids framing"]
  },

  /* ─────────────────────── SCORING ─────────────────────── */
  {
    route: "SCORING",
    stage: "THE THING YOU CAME FOR",
    title: "Containment is not a trustworthy number",
    difficulty: 5,

    brief: `
      <p>Back to line 85 of the first file: <code>scorer=includes()</code>.
      A scorer receives the <code>TaskState</code> and the sample's
      <code>Target</code> and returns a <code>Score</code>. This is the entire
      implementation of the most-used scorer in Inspect.</p>

      <p>Read <code>value</code> on line 27 and ask one question about it:
      who wrote that string?</p>`,

    file: "src/inspect_ai/scorer/_common.py · src/inspect_ai/scorer/_match.py",
    lines: "17–35 · 54–58",
    code: `
  |# src/inspect_ai/scorer/_common.py
17|def str_match_scorer(match: Callable[[str, str], tuple[str, bool]]) -> Scorer:
  |    ...
24|    async def score(state: TaskState, target: Target) -> Score:
25|        answer: str | None = None
26|        for value in target:
>27|            answer, matched = match(state.output.completion, value)
28|            if matched:
29|                return Score(
>30|                    value=CORRECT, answer=answer,
>  |                    explanation=state.output.completion
31|                )
  |
  |# src/inspect_ai/scorer/_match.py
54|    def check(value: str, target: str) -> tuple[str, bool]:
55|        if ignore_case:
56|            value = value.casefold()
57|            target = target.casefold()
>58|        return value, target in value`,

    look: `<code>state.output.completion</code> — the model's final text — and
           the operator on line 58, which is containment, not equality.`,

    hint: `Nothing here reads the sandbox, and nothing here escapes it. Ask
           what the score is a measurement <em>of</em>.`,

    question: `The agent never leaves the container. Which of these still makes
               the recorded score wrong?`,
    choices: [
      "None of them — an uncompromised container guarantees an honest score",
      "A final message that mentions the target string among other text, since the scorer searches text the model authored",
      "Only a compromised scorer process, which needs a host escape first",
      "Only a mismatch between the dataset target and the task's own answer key"
    ],
    correct: 1,

    why: [
      `<code>target in value</code> is satisfied by any occurrence anywhere in
       the completion. "It could be 41, 42 or 43" scores
       <code>CORRECT</code> against target <code>"42"</code>. No escape is
       needed, because the string being searched is the string the model
       wrote.`,
      `Generalise it: <b>containment protects the host; it says nothing about
       measurement integrity.</b> Anything the agent can influence that the
       scorer later reads — test files, <code>PATH</code>, an interpreter, a
       config file, a results file, a background process still running at
       scoring time — is in scope, and none of it requires breaking out.
       Whether it matters is <em>conditional</em> on how a given scorer is
       written.`,
      `Note line 30 as well: the completion is stored in the score's
       explanation, so agent-authored text flows onward into your logs and into
       the viewer from step 19. That is the loop closed — the walk began with a
       model-chosen argument crossing into host code, and it ends with
       model-authored text becoming your result.`
    ],
    label: "CONDITIONAL",
    ref: "Surface review §18 — scoring and benchmark-integrity surface",
    flow: "model completion → scorer string match → Score → metrics → your results table",
    takeaway: ["Measurement", "The score is computed over agent-authored text", "Containment ≠ a trustworthy number"]
  }

];

/* ────────────────────────────── machinery ────────────────────────────── */

const $ = (id) => document.getElementById(id);
const screens = () => [$("welcome"), $("lesson"), $("finish")];
const TOTAL = QUESTIONS.length;
const pad = (n) => String(n).padStart(2, "0");

let index = 0;
let picked = null;
let answered = false;
let score = 0;
let attempts = 0;

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

/** Render the excerpt format documented at the top of this file. */
function renderCode(source) {
  return source
    .replace(/^\n/, "")
    .split("\n")
    .map((line) => {
      const hot = line.startsWith(">");
      const [num, ...rest] = (hot ? line.slice(1) : line).split("|");
      const text = rest.join("|");
      return (
        `<span class="row${hot ? " hot" : ""}">` +
        `<span class="ln">${escapeHtml(num.trim())}</span>` +
        `<span class="src">${escapeHtml(text) || " "}</span>` +
        `</span>`
      );
    })
    .join("");
}

function show(section) {
  screens().forEach((s) => (s.hidden = s !== section));
  $("progress").hidden = section !== $("lesson");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* Where you are lives in the URL fragment, so a refresh comes back to the same
   question. It has to be the fragment: history.pushState() throws on file://,
   where the document's origin is null. */

const slug = (i) => `${pad(i + 1)}-${QUESTIONS[i].route.toLowerCase()}`;

function setHash(value) {
  if (location.hash !== `#${value}`) location.hash = value;
}

/** Accepts "#04", "#mcp" and "#04-lifecycle", plus "#welcome" and "#summary". */
function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, "")).trim().toLowerCase();
  if (raw === "summary") return { screen: "summary" };
  const n = parseInt(raw, 10);
  if (n >= 1 && n <= TOTAL) return { screen: "question", index: n - 1 };
  const i = QUESTIONS.findIndex((q) => raw === q.route.toLowerCase());
  if (i >= 0) return { screen: "question", index: i };
  return { screen: "welcome" };
}

// Idempotent, so the hashchange our own writes provoke is a no-op.
function routeFromHash() {
  const target = parseHash();
  if (target.screen === "question") {
    if (target.index === index && !$("lesson").hidden) return;
    goTo(target.index);
  } else if (target.screen === "summary") {
    if ($("finish").hidden) complete();
  } else if ($("welcome").hidden) {
    show($("welcome"));
  }
}

function goTo(i) {
  index = i;
  show($("lesson"));
  render();
}

function begin() {
  score = 0;
  attempts = 0;
  goTo(0);
}

function render() {
  const q = QUESTIONS[index];
  picked = null;
  answered = false;

  $("count").textContent = `${pad(index + 1)} / ${pad(TOTAL)}`;
  $("bar").style.width = `${((index + 1) / TOTAL) * 100}%`;
  $("route").innerHTML = QUESTIONS.map(
    (item, i) =>
      `<span class="${i < index ? "done" : i === index ? "now" : ""}">${pad(i + 1)} · ${item.route}</span>`
  ).join("");

  $("stage").textContent = `STEP ${index + 1} · ${q.stage}`;
  $("qtitle").innerHTML = q.title;
  $("pips").innerHTML =
    "▰".repeat(q.difficulty) + `<i>${"▰".repeat(5 - q.difficulty)}</i>`;
  $("pips").title = `difficulty ${q.difficulty} of 5`;
  $("brief").innerHTML = q.brief;
  $("path").textContent = `${q.file}   ${q.lines}`;
  $("code").innerHTML = renderCode(q.code);
  $("look").innerHTML = q.look;
  $("hint").innerHTML = q.hint;
  $("hintbox").open = false;

  $("qnum").textContent = `QUESTION ${pad(index + 1)}`;
  $("question").innerHTML = q.question;
  $("choices").innerHTML = q.choices
    .map(
      (text, i) =>
        `<label class="choice"><input type="radio" name="choice" value="${i}">` +
        `<b>${"ABCD"[i]}</b><span>${text}</span></label>`
    )
    .join("");
  $("choices")
    .querySelectorAll("input")
    .forEach((input) => (input.onchange = () => choose(Number(input.value))));

  $("check").disabled = true;
  $("check").textContent = "Check answer";
  $("answer").hidden = true;
  $("copy").textContent = "copy";

  setHash(slug(index));
}

function choose(i) {
  if (answered) return;
  picked = i;
  [...$("choices").children].forEach((el, j) => el.classList.toggle("pick", i === j));
  $("check").disabled = false;
}

function check() {
  // second press advances
  if (answered) {
    if (index < TOTAL - 1) {
      index++;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      complete();
    }
    return;
  }
  if (picked === null) return;

  const q = QUESTIONS[index];
  const right = picked === q.correct;
  answered = true;
  attempts++;
  if (right) score++;

  [...$("choices").children].forEach((el, i) => {
    el.classList.remove("pick");
    el.querySelector("input").disabled = true;
    if (i === q.correct) el.classList.add("right");
    if (i === picked && !right) el.classList.add("wrong");
  });

  $("answer").innerHTML =
    `<h4 class="${right ? "ok" : "no"}">${right ? "Correct" : "Not quite"}</h4>` +
    q.why.map((para) => `<p>${para}</p>`).join("") +
    `<div class="flow">${q.flow}</div>` +
    `<div class="meta"><span class="status">${q.label}</span><small>${q.ref}</small></div>`;
  $("answer").hidden = false;
  $("check").textContent =
    index === TOTAL - 1 ? "See the summary →" : "Next question →";
}

function complete() {
  show($("finish"));
  setHash("summary");
  $("score").textContent =
    attempts === TOTAL
      ? `${score} of ${TOTAL} first-guess answers correct — the explanations are the point, not the tally.`
      : attempts === 0
        ? `No tally this time — you came straight to the summary. The explanations are the point anyway.`
        : `${score} of the ${attempts} question${attempts === 1 ? "" : "s"} you answered since the page last loaded — a reload resets the tally, which is fine: the explanations are the point.`;
  $("map").innerHTML = QUESTIONS.map(
    (q, i) =>
      `<div><small>${pad(i + 1)}</small><strong>${q.takeaway[0]}</strong>` +
      `<span>${q.takeaway[1]}<br><b>${q.takeaway[2]}</b></span></div>`
  ).join("");
}

$("start").onclick = begin;
$("restart").onclick = begin;
$("home").onclick = () => {
  setHash("welcome");
  show($("welcome"));
};
$("check").onclick = check;
window.onhashchange = routeFromHash;

// Copy an editor command that jumps straight to the excerpt.
$("copy").onclick = async () => {
  const q = QUESTIONS[index];
  const path = q.file.split(" · ")[0];
  const line = (q.lines.match(/\d+/) || [""])[0];
  try {
    await navigator.clipboard.writeText(`code -g ${path}:${line}`);
    $("copy").textContent = "copied ✓";
  } catch {
    $("copy").textContent = "copy blocked";
  }
};

document.onkeydown = (e) => {
  if ($("lesson").hidden) return;
  const i = "abcd".indexOf(e.key.toLowerCase());
  if (i >= 0 && !answered) $("choices").querySelectorAll("input")[i]?.click();
  if (e.key === "Enter" && !$("check").disabled) check();
};

routeFromHash();
