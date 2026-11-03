"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, CheckCircle2, AlertTriangle, Loader2, Clock, FileText, Download, Send, MessageSquare,
  ArrowLeft, ShieldCheck, Palette, RefreshCw, XCircle,
} from "lucide-react";
import { Button, Card, CardHeader, Badge, ScoreRing, EmptyState } from "@/components/ui";
import { ResumeEditor } from "@/components/ResumeEditor";
import { ResumePreview } from "@/components/ResumePreview";
import type { Profile } from "@/components/ProfileEditor";
import { API_BASE, postJson, downloadFile } from "@/lib/api";
import type { Job, Tailored, TemplateInfo, ResumeDoc, AtsReport } from "@/lib/types";

/** Contact details always come from My details, so edits there flow into every resume. */
function withContact(resume: ResumeDoc, p: Profile): ResumeDoc {
  return { ...resume, name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, portfolio: p.portfolio, location: p.location };
}

export function TailorWorkspace({
  jobs, profile, tailored, setTailored, template, setTemplate, activeJobId, setActiveJobId,
  onInterview, onApply, applying, applyResult, onBackToJobs, onError,
}: {
  jobs: Job[];
  profile: Profile;
  tailored: Record<string, Tailored>;
  setTailored: (fn: (prev: Record<string, Tailored>) => Record<string, Tailored>) => void;
  template: string;
  setTemplate: (t: string) => void;
  activeJobId: string | null;
  setActiveJobId: (id: string) => void;
  onInterview: () => void;
  onApply: (job: Job, resume: ResumeDoc, template: string) => void;
  applying: boolean;
  applyResult: any;
  onBackToJobs: () => void;
  onError: (message: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "docx" | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("cf_token") || "";
    fetch(`${API_BASE}/api/resume/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setTemplates).catch(() => {});
  }, []);

  const activeJob = jobs.find(j => j.uuid === activeJobId) ?? jobs[0];
  const active = activeJob ? tailored[activeJob.uuid] : undefined;
  const doneCount = jobs.filter(j => tailored[j.uuid]?.status === "done").length;
  const resume = useMemo(
    () => (active?.resume ? withContact(active.resume, profile) : undefined),
    [active?.resume, profile],
  );

  const tailorOne = async (job: Job) => {
    setTailored(prev => ({ ...prev, [job.uuid]: { status: "working" } }));
    try {
      const form = new FormData();
      form.append("profile_json", JSON.stringify(profile));
      form.append("job_uuid", job.uuid);
      form.append("job_json", JSON.stringify(job));
      form.append("template", template);
      const data = await postJson<Tailored>("/api/resume/tailor", form);
      setTailored(prev => ({ ...prev, [job.uuid]: { ...data, status: "done" } }));
    } catch (e: any) {
      setTailored(prev => ({ ...prev, [job.uuid]: { status: "error", error: e.message || "Tailoring failed" } }));
    }
  };

  /** One at a time: free AI tiers allow only so many tokens per minute. */
  const tailorAll = async (onlyMissing = true) => {
    setRunning(true);
    const queue = jobs.filter(j => !onlyMissing || tailored[j.uuid]?.status !== "done");
    setTailored(prev => {
      const next = { ...prev };
      queue.forEach(j => { next[j.uuid] = { status: "queued" }; });
      return next;
    });
    if (queue[0]) setActiveJobId(queue[0].uuid);
    for (const job of queue) await tailorOne(job);
    setRunning(false);
  };

  // Re-score the ATS checks (instant, no AI) when the resume or template changes
  const keywordsRef = useRef<string[]>([]);
  keywordsRef.current = active?.job_keywords ?? [];
  useEffect(() => {
    if (!resume || !activeJob) return;
    const id = activeJob.uuid;
    const timer = setTimeout(async () => {
      try {
        const form = new FormData();
        form.append("resume_json", JSON.stringify(resume));
        form.append("job_keywords", JSON.stringify(keywordsRef.current));
        form.append("template", template);
        const ats = await postJson<AtsReport>("/api/resume/ats", form);
        setTailored(prev => (prev[id] ? { ...prev, [id]: { ...prev[id], ats } } : prev));
      } catch {}
    }, 600);
    return () => clearTimeout(timer);
  }, [resume, template, activeJob, setTailored]);

  const download = async (format: "pdf" | "docx") => {
    if (!resume || !activeJob) return;
    setDownloading(format);
    try {
      const form = new FormData();
      form.append("resume_json", JSON.stringify(resume));
      form.append("template", template);
      form.append("format", format);
      await downloadFile("/api/resume/export", form, `Resume.${format}`);
    } catch (e: any) {
      onError(e.message || "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="w-6 h-6" />}
        title="Pick the jobs you want to apply for"
        description="Select one or more jobs on the Discover step. We'll tailor a resume for each one."
        action={<Button onClick={onBackToJobs} icon={<ArrowLeft className="w-4 h-4" />}>Back to jobs</Button>}
      />
    );
  }

  const chosen = templates.find(t => t.id === template);

  return (
    <div className="space-y-6">
      {/* Template picker */}
      <Card>
        <CardHeader icon={<Palette className="w-[18px] h-[18px]" />} title="Choose a template"
                    subtitle="Applies to all your resumes. You can switch any time; the content stays the same." />
        <div className="px-5 sm:px-6 pb-5">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {templates.map(t => (
              <button key={t.id} type="button" onClick={() => setTemplate(t.id)} aria-pressed={template === t.id}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                        template === t.id ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:bg-surface-2"}`}>
                <span className={`block text-sm font-medium ${template === t.id ? "text-brand" : "text-ink"}`}>{t.label}</span>
                <span className={`block text-[11px] ${t.ats_safe ? "text-success" : "text-warning"}`}>
                  {t.ats_safe ? "ATS-safe" : "Design-forward"}
                </span>
              </button>
            ))}
          </div>
          {chosen && !chosen.ats_safe && (
            <p className="mt-3 flex gap-2 text-xs text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Looks great to people, but applicant tracking systems can misread its headings. Use an ATS-safe template for online applications.
            </p>
          )}
        </div>
      </Card>

      {/* Batch run */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">
              {doneCount === jobs.length ? `All ${jobs.length} resumes are ready` : `Tailor ${jobs.length} resume${jobs.length > 1 ? "s" : ""}`}
            </h3>
            <p className="text-sm text-muted mt-0.5">
              Each one is rewritten for its job using ATS rules. Nothing is invented: new keywords you lack appear as suggestions.
            </p>
          </div>
          <Button size="lg" onClick={() => tailorAll(true)} loading={running} disabled={running || doneCount === jobs.length}
                  icon={<Sparkles className="w-4 h-4" />} className="shrink-0">
            {running ? `Tailoring ${Math.min(doneCount + 1, jobs.length)} of ${jobs.length}…` : doneCount ? "Tailor the rest" : "Tailor my resumes"}
          </Button>
        </div>

        {/* One tab per job, with its status */}
        <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar">
          {jobs.map(job => {
            const t = tailored[job.uuid];
            const isActive = activeJob?.uuid === job.uuid;
            const icon = t?.status === "done" ? <CheckCircle2 className="w-4 h-4 text-success" />
              : t?.status === "working" ? <Loader2 className="w-4 h-4 animate-spin text-brand" />
              : t?.status === "error" ? <XCircle className="w-4 h-4 text-danger" />
              : <Clock className="w-4 h-4 text-subtle" />;
            return (
              <button key={job.uuid} type="button" onClick={() => setActiveJobId(job.uuid)} aria-pressed={isActive}
                      className={`shrink-0 max-w-[240px] rounded-lg border px-3 py-2 text-left transition-colors ${
                        isActive ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  {icon}<span className="truncate">{job.title}</span>
                </span>
                <span className="block text-xs text-muted truncate">
                  {job.company}{t?.ats ? ` · ATS ${t.ats.score}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Active resume */}
      {active?.status === "error" && (
        <Card className="p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-sm text-danger"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{active.error}</p>
          <Button variant="secondary" onClick={() => tailorOne(activeJob)} icon={<RefreshCw className="w-4 h-4" />}>Try again</Button>
        </Card>
      )}

      {resume && active?.status === "done" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6 min-w-0">
            {active.ats && (
              <Card>
                <div className="flex items-center gap-4 px-5 sm:px-6 pt-5">
                  <ScoreRing score={active.ats.score} size={64} />
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-ink flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-brand" /> ATS check
                    </h3>
                    <p className="text-sm text-muted">Updates as you edit. Based on sg-job-hunter&apos;s ATS rules.</p>
                  </div>
                </div>
                <ul className="divide-y divide-line mt-4 border-t border-line">
                  {active.ats.checks.map(c => (
                    <li key={c.id} className="flex gap-3 px-5 sm:px-6 py-3">
                      {c.passed ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                                : <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{c.label}</p>
                        <p className="text-xs text-muted leading-relaxed">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {active.changes && active.changes.length > 0 && (
              <Card className="p-5 sm:p-6">
                <h3 className="text-[15px] font-semibold text-ink mb-2">What we changed</h3>
                <ul className="space-y-1.5">
                  {active.changes.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm text-text"><Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />{c}</li>
                  ))}
                </ul>
              </Card>
            )}

            <Card className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-[15px] font-semibold text-ink">Edit resume</h3>
                <Button variant="ghost" size="sm" onClick={() => tailorOne(activeJob)} icon={<RefreshCw className="w-3.5 h-3.5" />}>
                  Re-tailor
                </Button>
              </div>
              <ResumeEditor
                resume={resume}
                suggestions={active.suggested_keywords}
                onChange={(r) => setTailored(prev => ({ ...prev, [activeJob.uuid]: { ...prev[activeJob.uuid], resume: r } }))}
              />
            </Card>
          </div>

          <div className="space-y-4 min-w-0 lg:sticky lg:top-36 lg:self-start">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => download("pdf")} loading={downloading === "pdf"} disabled={downloading !== null}
                      icon={<Download className="w-4 h-4" />}>PDF</Button>
              <Button variant="secondary" onClick={() => download("docx")} loading={downloading === "docx"} disabled={downloading !== null}
                      icon={<Download className="w-4 h-4" />}>Word</Button>
              <Button variant="secondary" onClick={onInterview} icon={<MessageSquare className="w-4 h-4" />}>Interview prep</Button>
              <Button variant="secondary" onClick={() => onApply(activeJob, resume, template)} loading={applying}
                      disabled={applying || !activeJob.job_url} icon={<Send className="w-4 h-4" />}
                      title="Opens the job in a browser window, fills in your details and attaches this resume. You press Submit.">
                {applying ? "Opening…" : "Apply (you submit)"}
              </Button>
            </div>
            <ResumePreview resume={resume} template={template} />
            {applyResult && (
              <div className={`rounded-lg border p-4 ${applyResult.status === "ready_for_review" ? "border-brand/30 bg-brand-soft" : "border-warning/30 bg-warning-soft"}`}>
                <p className={`flex items-center gap-2 text-sm font-semibold ${applyResult.status === "ready_for_review" ? "text-brand" : "text-warning"}`}>
                  {applyResult.status === "ready_for_review" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {applyResult.status === "ready_for_review"
                    ? "Opened in a new browser window: review it and press Submit yourself"
                    : "Couldn't open the application"}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-text">
                  {applyResult.steps?.map((s: string, i: number) => <li key={i} className="break-words">• {s}</li>)}
                  {applyResult.errors?.map((e: string, i: number) => <li key={`e${i}`} className="text-danger break-words">• {e}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {!resume && active?.status !== "error" && (
        <Card className="px-6 py-10 text-center">
          {active?.status === "working" || active?.status === "queued" ? (
            <>
              <Loader2 className="w-6 h-6 text-brand animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-ink">{active.status === "working" ? "Tailoring this resume…" : "Waiting its turn…"}</p>
              <p className="text-xs text-muted mt-1">Usually 5-30 seconds each. Free AI tiers may pause briefly between resumes.</p>
            </>
          ) : (
            <>
              <FileText className="w-6 h-6 text-muted mx-auto mb-3" />
              <p className="text-sm font-medium text-ink">Not tailored yet</p>
              <p className="text-xs text-muted mt-1">Press &quot;Tailor my resumes&quot; to create one for each selected job.</p>
            </>
          )}
        </Card>
      )}

      <div>
        <Badge>{doneCount} of {jobs.length} ready</Badge>
      </div>
    </div>
  );
}
