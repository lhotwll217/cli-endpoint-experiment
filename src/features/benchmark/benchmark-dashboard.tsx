"use client";

import * as React from "react";
import {
  Activity,
  Braces,
  ChevronDown,
  Clock,
  Loader2,
  Play,
  RotateCcw,
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function BenchmarkDashboard() {
  const [draft, setDraft] = React.useState("");
  const { runs, messages, send, cancel, clear, isRunning } = useBenchmarkChat();

  async function submit() {
    const prompt = draft.trim();
    if (!prompt || isRunning) {
      return;
    }
    setDraft("");
    await send(APPROACHES, prompt);
  }

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto grid h-screen w-full max-w-[1720px] grid-rows-[auto_1fr_auto] gap-3 px-4 py-3 lg:px-5">
          <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="outline">PostHog</Badge>
                <Badge variant="muted">Same prompt, two integration surfaces</Badge>
              </div>
              <h1 className="truncate text-xl font-semibold tracking-normal lg:text-2xl">
                HTTP CLI vs MCP
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={() => cancel()} disabled={!isRunning}>
                    <Square className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Cancel active runs</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={clear}>
                    <RotateCcw className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New race</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <section className="grid min-h-0 gap-3 lg:grid-cols-2">
            {APPROACHES.map((approach) => (
              <RacePane
                key={approach}
                approach={approach}
                run={runs[approach]}
                messages={messages.filter((message) => isVisibleInApproach(message, approach))}
              />
            ))}
          </section>

          <Composer draft={draft} isRunning={isRunning} onDraftChange={setDraft} onSubmit={submit} />
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

function RacePane({
  approach,
  run,
  messages,
}: {
  approach: Approach;
  run: BenchmarkRun;
  messages: BenchmarkChatEntry[];
}) {
  const theme = getApproachTheme(approach);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: theme.cssVar }} />
          <span className="truncate text-sm font-semibold">{theme.label}</span>
          <Badge variant="outline">{run.status}</Badge>
          {run.status === "running" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <TraceDialog
            label={`${theme.label} trace`}
            metrics={run.metrics}
            traces={run.traces}
            error={run.error}
          />
        </div>
      </div>

      <MetricsStrip run={run} />

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
        <div className="flex w-full flex-col gap-4 px-3 py-4">
          {messages.length === 0 ? (
            <EmptyConversation approach={approach} />
          ) : (
            messages.map((message) => <ChatMessage key={message.id} message={message} approach={approach} />)
          )}
        </div>
      </div>
    </div>
  );
}

function MetricsStrip({ run }: { run: BenchmarkRun }) {
  const elapsedMs = useElapsedMs(run);
  const metrics = run.metrics;

  return (
    <div className="grid grid-cols-3 gap-2 border-b border-border bg-card px-3 py-2 text-xs">
      <StripMetric
        icon={<Activity className="size-3.5" />}
        label="Tokens"
        value={metrics.totalTokens.toLocaleString()}
        detail={`${metrics.promptTokens.toLocaleString()} in / ${metrics.completionTokens.toLocaleString()} out`}
      />
      <StripMetric
        icon={<Wrench className="size-3.5" />}
        label="Tool calls"
        value={String(metrics.toolCalls)}
        detail={`${formatBytes(metrics.outputBytes)} output`}
      />
      <StripMetric
        icon={<Clock className="size-3.5" />}
        label="Elapsed"
        value={formatMs(elapsedMs)}
        detail={run.status === "running" ? "live" : "latest turn"}
      />
    </div>
  );
}

function StripMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-1.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 truncate font-medium tabular-nums">{value}</div>
      <div className="truncate text-[10px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function useElapsedMs(run: BenchmarkRun): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (run.status !== "running") {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [run.status]);

  if (run.status === "running" && run.startedAt) {
    return Math.max(0, now - new Date(run.startedAt).getTime());
  }
  return run.metrics.latencyMs;
}

function EmptyConversation({ approach }: { approach: Approach }) {
  const theme = getApproachTheme(approach);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background">
        <Activity className="size-5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-base font-semibold">{theme.label}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{theme.description}</p>
      </div>
    </div>
  );
}

function ChatMessage({ message, approach }: { message: BenchmarkChatEntry; approach: Approach }) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
          {message.content}
        </div>
      </article>
    );
  }

  const theme = getApproachTheme(approach);
  const toolCards = groupToolCalls(message.traces ?? []);

  return (
    <article className="flex justify-start">
      <div className="w-full max-w-[95%] rounded-lg border border-border bg-background shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: theme.cssVar }} />
            <span className="text-sm font-medium">{theme.label}</span>
            <Badge variant="outline">{message.status ?? "idle"}</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{message.metrics?.totalTokens.toLocaleString() ?? 0} tokens</span>
            <span>{message.metrics?.toolCalls ?? 0} tools</span>
          </div>
        </div>

        {toolCards.length > 0 && (
          <div className="space-y-2 border-b border-border bg-muted/20 p-2">
            {toolCards.map((card, index) => (
              <ToolCallCard key={card.key} card={card} index={index} />
            ))}
          </div>
        )}

        <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-6">
          {message.content ? (
            message.content
          ) : message.status === "running" ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {toolCards.length > 0 ? "Working through tool calls..." : "Agent loop running..."}
            </span>
          ) : message.error ? null : toolCards.length > 0 ? (
            <span className="text-muted-foreground">Agent returned tool events but no final text.</span>
          ) : (
            <span className="text-muted-foreground">No assistant text.</span>
          )}
          {message.error && <div className={`text-sm text-destructive ${message.content ? "mt-3" : ""}`}>{message.error}</div>}
        </div>
      </div>
    </article>
  );
}

type ToolCallCard = {
  key: string;
  toolName: string;
  summary: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  outputBytes: number;
  pending: boolean;
};

// Call and result traces carry independent ids, so pair them by order: a
// tool-call opens a card and the next result/error for that tool closes it.
function groupToolCalls(traces: ToolTrace[]): ToolCallCard[] {
  const cards: ToolCallCard[] = [];

  for (const trace of traces) {
    if (trace.phase === "tool-call") {
      cards.push({
        key: trace.id,
        toolName: trace.toolName,
        summary: summarizeInput(trace.toolName, trace.input),
        input: trace.input,
        outputBytes: 0,
        pending: true,
      });
      continue;
    }

    if (trace.phase !== "tool-result" && trace.phase !== "tool-error") {
      continue;
    }

    const open = cards.findLast((card) => card.pending && card.toolName === trace.toolName);
    if (!open) {
      continue;
    }

    open.pending = false;
    open.output = trace.output;
    open.error = trace.error;
    open.durationMs = trace.durationMs;
    open.outputBytes = payloadBytes(trace.output ?? trace.error);
  }

  return cards;
}

function summarizeInput(toolName: string, input: unknown): string {
  if (input && typeof input === "object" && "command" in input && typeof input.command === "string") {
    return input.command;
  }
  if (input === undefined || input === null) {
    return toolName;
  }
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text === "{}" ? toolName : `${toolName} ${text}`;
}

function payloadBytes(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return new TextEncoder().encode(text).byteLength;
}

function ToolCallCard({ card, index }: { card: ToolCallCard; index: number }) {
  return (
    <details className="group rounded-md border border-border bg-background text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className={card.error ? "border-destructive text-destructive" : undefined}>
            {index + 1}
          </Badge>
          <code className="truncate font-mono">{card.summary}</code>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {card.pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <>
              {card.durationMs !== undefined && <span>{formatMs(card.durationMs)}</span>}
              <span>{formatBytes(card.outputBytes)}</span>
            </>
          )}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-2 border-t border-border p-3">
        <ToolCallPayload label="Input" value={card.input} />
        <ToolCallPayload label={card.error ? "Error" : "Output"} value={card.error ?? card.output} isError={Boolean(card.error)} />
      </div>
    </details>
  );
}

function ToolCallPayload({ label, value, isError }: { label: string; value: unknown; isError?: boolean }) {
  const formatted = formatTracePayload(value);
  if (!formatted) {
    return null;
  }

  return (
    <div>
      <div className={`mb-1 font-medium ${isError ? "text-destructive" : "text-muted-foreground"}`}>{label}</div>
      <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-muted px-2 py-2 text-[11px] leading-5 text-foreground">
        {formatted}
      </pre>
    </div>
  );
}

function formatTracePayload(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 6_000 ? `${text.slice(0, 6_000)}...` : text;
}

function Composer({
  draft,
  isRunning,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  isRunning: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-lg border border-input bg-background shadow-sm">
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Ask an analytics question. The same prompt runs against both surfaces."
        className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
        <span className="text-xs text-muted-foreground">
          One prompt, both panes. Follow-ups continue each conversation separately.
        </span>
        <Button onClick={onSubmit} disabled={isRunning || !draft.trim()}>
          <Play className="size-4" />
          Race
        </Button>
      </div>
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
