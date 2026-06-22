"use client";

import * as React from "react";
import {
  Activity,
  Braces,
  ChevronDown,
  Clock,
  Code2,
  FileText,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Square,
  Wrench,
} from "lucide-react";
import { APPROACHES, type Approach, type BenchmarkRun, type RunMetrics, type ToolTrace } from "@/core/domain/benchmark";
import { getApproachTheme } from "@/config/theme.config";
import { type BenchmarkChatEntry, useBenchmarkChat } from "@/features/benchmark/use-benchmark-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function BenchmarkDashboard() {
  const [activeApproach, setActiveApproach] = React.useState<Approach>("cli");
  const [draft, setDraft] = React.useState("");
  const { runs, messages, send, cancel, clear, isRunning } = useBenchmarkChat();
  const hasStarted = messages.length > 0;
  const activeMessages = messages.filter((message) => isVisibleInApproach(message, activeApproach));

  async function submit(target: Approach | "all") {
    const prompt = draft.trim();
    if (!prompt || isRunning) {
      return;
    }

    const resolvedTarget = target === "all" && hasStarted ? activeApproach : target;
    setDraft("");
    await send(resolvedTarget, prompt);
  }

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto grid h-screen w-full max-w-[1720px] grid-rows-[auto_1fr] gap-3 px-4 py-3 lg:px-5">
          <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="outline">PostHog</Badge>
                <Badge variant="muted">Agent loop comparison</Badge>
              </div>
              <h1 className="truncate text-xl font-semibold tracking-normal lg:text-2xl">
                Parallel Chat Workbench
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={() => cancel()} disabled={!isRunning}>
                    <Square className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Cancel active run</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={clear}>
                    <RotateCcw className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New chat</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <section className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
              <Tabs
                value={activeApproach}
                onValueChange={(value) => setActiveApproach(value as Approach)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <TabsList className="grid h-10 w-full grid-cols-3 sm:w-[420px]">
                    {APPROACHES.map((approach) => {
                      const theme = getApproachTheme(approach);
                      const run = runs[approach];
                      return (
                        <TabsTrigger key={approach} value={approach} className="h-8 gap-2">
                          <span className="size-2 rounded-full" style={{ background: theme.cssVar }} />
                          {theme.label}
                          {run.status === "running" && <Loader2 className="size-3 animate-spin" />}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{hasStarted ? "Follow-ups go to the active tab" : "First prompt can fan out to all tabs"}</span>
                    <TraceDialog
                      label={`${getApproachTheme(activeApproach).label} trace`}
                      metrics={runs[activeApproach].metrics}
                      traces={runs[activeApproach].traces}
                      error={runs[activeApproach].error}
                    />
                  </div>
                </div>

                {APPROACHES.map((approach) => (
                  <TabsContent key={approach} value={approach} className="m-0 flex min-h-0 flex-1 flex-col">
                    <ChatTranscript
                      approach={approach}
                      messages={approach === activeApproach ? activeMessages : messages.filter((message) => isVisibleInApproach(message, approach))}
                      run={runs[approach]}
                    />
                  </TabsContent>
                ))}
              </Tabs>

              <Composer
                activeApproach={activeApproach}
                draft={draft}
                hasStarted={hasStarted}
                isRunning={isRunning}
                onDraftChange={setDraft}
                onSubmit={submit}
              />
            </div>

            <aside className="hidden min-h-0 flex-col gap-3 xl:flex">
              <ReadoutPanel runs={runs} />
            </aside>
          </section>
        </div>
      </main>
    </TooltipProvider>
  );
}

function isVisibleInApproach(message: BenchmarkChatEntry, approach: Approach) {
  if (message.role === "assistant") {
    return message.approach === approach;
  }
  return !message.approaches || message.approaches.includes(approach);
}

function ChatTranscript({
  approach,
  messages,
  run,
}: {
  approach: Approach;
  messages: BenchmarkChatEntry[];
  run: BenchmarkRun;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 pb-32">
        {messages.length === 0 ? (
          <EmptyConversation approach={approach} />
        ) : (
          messages.map((message) => <ChatMessage key={message.id} message={message} approach={approach} />)
        )}
        {run.status === "running" && !messages.some((message) => message.status === "running") && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Agent loop running...
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyConversation({ approach }: { approach: Approach }) {
  const theme = getApproachTheme(approach);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background">
        <Activity className="size-5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{theme.label} conversation</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Send a prompt to run the {theme.label} agent. Tool calls appear inside each response.
        </p>
      </div>
    </div>
  );
}

function ChatMessage({ message, approach }: { message: BenchmarkChatEntry; approach: Approach }) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[78%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
          {message.content}
        </div>
      </article>
    );
  }

  const theme = getApproachTheme(approach);
  const metrics = message.metrics;
  const toolTraceCount = getToolTraceEvents(message.traces ?? []).length;

  return (
    <article className="flex justify-start">
      <div className="max-w-[86%] rounded-lg border border-border bg-background shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: theme.cssVar }} />
            <span className="text-sm font-medium">{theme.label}</span>
            <Badge variant="outline">{message.status ?? "idle"}</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{metrics?.totalTokens.toLocaleString() ?? 0} tokens</span>
            <span>{metrics?.toolCalls ?? 0} tools</span>
            <TraceDialog
              label={`${theme.label} message trace`}
              metrics={metrics}
              traces={message.traces ?? []}
              error={message.error}
            />
          </div>
        </div>
        <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-6">
          {message.content ? (
            message.content
          ) : message.status === "running" ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Running agent loop...
            </span>
          ) : toolTraceCount > 0 ? (
            <span className="text-muted-foreground">Agent returned tool events but no final text. Open tool calls below.</span>
          ) : (
            <span className="text-muted-foreground">No assistant text.</span>
          )}
          {message.error && <div className="mt-3 text-sm text-destructive">{message.error}</div>}
        </div>
        <ToolCallsDisclosure traces={message.traces ?? []} />
      </div>
    </article>
  );
}

const TOOL_TRACE_PHASES: ToolTrace["phase"][] = [
  "tool-call",
  "tool-result",
  "tool-error",
  "stdout",
  "stderr",
  "exit",
];

function ToolCallsDisclosure({ traces }: { traces: ToolTrace[] }) {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const toolTraces = getToolTraceEvents(traces);

  if (toolTraces.length === 0) {
    return null;
  }

  const callCount = toolTraces.filter((trace) => trace.phase === "tool-call").length || toolTraces.length;

  return (
    <details
      ref={detailsRef}
      className="group scroll-mb-36 border-t border-border"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Wrench className="size-3.5 shrink-0" />
          <span className="truncate">Tool calls ({callCount})</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border bg-muted/20">
        <div className="space-y-3 p-3">
          {toolTraces.map((trace, index) => (
            <ToolTraceItem key={`${trace.id}-${trace.phase}-${index}`} trace={trace} index={index} />
          ))}
        </div>
      </div>
    </details>
  );
}

function ToolTraceItem({ trace, index }: { trace: ToolTrace; index: number }) {
  const payload = trace.error ?? trace.output ?? trace.input;
  const formattedPayload = formatTracePayload(payload);

  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className={trace.phase === "tool-error" || trace.phase === "stderr" ? "border-destructive text-destructive" : undefined}
          >
            {formatTracePhase(trace.phase)}
          </Badge>
          <span className="truncate font-medium">{trace.toolName || `tool-${index + 1}`}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {trace.durationMs !== undefined && <span>{formatMs(trace.durationMs)}</span>}
          <span>{new Date(trace.at).toLocaleTimeString()}</span>
        </div>
      </div>
      {formattedPayload && (
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-2 py-2 text-[11px] leading-5 text-foreground">
          {formattedPayload}
        </pre>
      )}
    </div>
  );
}

function getToolTraceEvents(traces: ToolTrace[]): ToolTrace[] {
  return traces.filter((trace) => TOOL_TRACE_PHASES.includes(trace.phase));
}

function formatTracePhase(phase: ToolTrace["phase"]): string {
  return phase.replaceAll("-", " ");
}

function formatTracePayload(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 1_800 ? `${text.slice(0, 1_800)}...` : text;
}

function Composer({
  activeApproach,
  draft,
  hasStarted,
  isRunning,
  onDraftChange,
  onSubmit,
}: {
  activeApproach: Approach;
  draft: string;
  hasStarted: boolean;
  isRunning: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (target: Approach | "all") => void;
}) {
  const activeTheme = getApproachTheme(activeApproach);

  return (
    <div className="border-t border-border bg-card p-3">
      <div className="mx-auto max-w-4xl rounded-lg border border-input bg-background shadow-sm">
        <Textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit(activeApproach);
            }
          }}
          placeholder={hasStarted ? `Message ${activeTheme.label}...` : "Ask the first benchmark question..."}
          className="min-h-24 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{draft.length.toLocaleString()} chars</span>
            <span>{hasStarted ? `Follow-up target: ${activeTheme.label}` : "Run All is only available before the first message"}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onSubmit(activeApproach)} disabled={isRunning || !draft.trim()}>
              <Send className="size-4" />
              Send
            </Button>
            <Button onClick={() => onSubmit("all")} disabled={isRunning || !draft.trim() || hasStarted}>
              <Play className="size-4" />
              Run All
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadoutPanel({ runs }: { runs: Record<Approach, BenchmarkRun> }) {
  return (
    <div className="min-h-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="text-base font-semibold">Readouts</h2>
        <p className="mt-1 text-sm text-muted-foreground">Latest turn metrics per integration.</p>
      </div>
      <div className="space-y-3 p-3">
        {APPROACHES.map((approach) => {
          const run = runs[approach];
          const theme = getApproachTheme(approach);
          return (
            <div key={approach} className="rounded-md border border-border bg-background p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: theme.cssVar }} />
                  <span className="text-sm font-medium">{theme.label}</span>
                </div>
                <Badge variant="outline">{run.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <MetricPill icon={<Activity className="size-3.5" />} label="Input Tok" value={run.metrics.promptTokens} />
                <MetricPill icon={<Activity className="size-3.5" />} label="Total Tok" value={run.metrics.totalTokens} />
                <MetricPill icon={<FileText className="size-3.5" />} label="Sys Prompt" value={formatBytes(run.metrics.systemPromptBytes)} />
                <MetricPill icon={<FileText className="size-3.5" />} label="Tool Prompt" value={formatBytes(run.metrics.toolPromptBytes)} />
                <MetricPill icon={<Clock className="size-3.5" />} label="Latency" value={formatMs(run.metrics.latencyMs)} />
                <MetricPill icon={<Code2 className="size-3.5" />} label="LOC" value={run.metrics.loc} />
                <MetricPill icon={<Wrench className="size-3.5" />} label="Tools" value={run.metrics.toolCalls} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-2">
      <div className="mb-1 flex items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="truncate font-medium tabular-nums">{value}</div>
    </div>
  );
}

function TraceDialog({
  label,
  metrics,
  traces,
  error,
}: {
  label: string;
  metrics: RunMetrics | unknown;
  traces: ToolTrace[] | unknown[];
  error?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <Braces className="size-3.5" />
          Trace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{traces.length} trace events</DialogDescription>
        </DialogHeader>
        <Separator />
        <ScrollArea className="h-[65vh]">
          <pre className="whitespace-pre-wrap p-4 text-xs leading-5">
            {JSON.stringify({ metrics, traces, error }, null, 2)}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function formatMs(value: number): string {
  if (!value) {
    return "0ms";
  }

  if (value < 1_000) {
    return `${value}ms`;
  }

  return `${(value / 1_000).toFixed(1)}s`;
}

function formatBytes(value: number): string {
  if (value < 1_000) {
    return `${value}B`;
  }

  return `${(value / 1_000).toFixed(1)}KB`;
}
