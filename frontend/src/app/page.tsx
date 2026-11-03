"use client";
import { useState, useCallback, useEffect, type ReactNode } from "react";
import {
  Upload, Search, TrendingUp, FileText, MessageSquare, Sparkles, ArrowRight, ArrowLeft, CheckCircle2,
  Loader2, Briefcase, MapPin, Clock, BookOpen, Target, Lock, Send, Download, LogOut, ExternalLink,
  Wallet, FileUp, Building2, Lightbulb, ShieldCheck, Check, AlertTriangle, X, GraduationCap,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/Logo";
import {
  Button, Card, CardHeader, Badge, ScoreRing, PageHeader, EmptyState, inputClass, levelTone,
} from "@/components/ui";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type Step = "upload" | "discover" | "gaps" | "prepare" | "interview";
type Busy = "parse" | "search" | "gaps" | "rewrite" | "interview" | "download" | "apply" | null;
type AuthState = "checking" | "signed-out" | "signed-in";

interface Job {
  uuid: string;
  title: string;
  company: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_type: string;
  skills: string[];
  experience_required: number;
  location: string;
  district: string;
  region: string;
  employment_type: string;
  position_level: string;
  description: string;
  job_url: string;
  posted_date: string;
  views: number;
  applications: number;
  match_score: number;
  source: string;
}

interface Profile {
  name: string;
  title: string;
  summary: string;
  skills: string[];
  experience_years: number;
  education: string[];
  work_history: any[];
  certifications: string[];
}

const steps: { key: Step; label: string; icon: typeof Upload }[] = [
  { key: "upload", label: "Profile", icon: Upload },
  { key: "discover", label: "Discover", icon: Search },
  { key: "gaps", label: "Skill gaps", icon: TrendingUp },
  { key: "prepare", label: "Tailor resume", icon: FileText },
  { key: "interview", label: "Interview", icon: MessageSquare },
];

const allSources = [
  { key: "mcf", label: "MyCareersFuture" },
  { key: "jobstreet", label: "JobStreet" },
  { key: "indeed", label: "Indeed SG" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "glassdoor", label: "Glassdoor" },
];

const sourceLabel = (key: string) => allSources.find(s => s.key === key)?.label ?? key;

const money = (n?: number | null) => (n ? `S$${n.toLocaleString()}` : "");

const NETWORK_ERROR =
  "We couldn't reach the CareerFlow server. It may be waking up or restarting. Please try again in a minute.";

/**
 * POST that retries once on a network failure or gateway error (the free-tier
 * backend sleeps and restarts). Not for non-idempotent actions like auto-apply.
 */
async function postWithRetry(url: string, body: FormData, retry = true): Promise<Response> {
  try {
    const res = await fetch(url, { method: "POST", body });
    if (retry && [502, 503, 504].includes(res.status)) throw new TypeError("gateway");
    return res;
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    if (!retry) throw new Error(NETWORK_ERROR);
    await new Promise(r => setTimeout(r, 4000));
    return postWithRetry(url, body, false);
  }
}

/** Pull FastAPI's `detail` out of an error response instead of showing raw JSON. */
async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (typeof data.detail === "string") return data.detail;
  } catch {}
  return text || `Request failed (${res.status})`;
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-text leading-relaxed">
      <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function SlowNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="text-xs text-muted mt-2 text-center">This can take 10–40 seconds. Hang tight.</p>;
}

export default function Home() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [inviteCode, setInviteCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [maxStep, setMaxStep] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const [resumeText, setResumeText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [targetRole, setTargetRole] = useState("");
  const [targetIndustry, setTargetIndustry] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>(["mcf"]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [resumeRewrite, setResumeRewrite] = useState<any>(null);
  const [interviewPrep, setInterviewPrep] = useState<any>(null);
  const [applyResult, setApplyResult] = useState<any>(null);

  const searchQuery = `${targetRole} ${targetIndustry}`.trim();
  const stepIndex = steps.findIndex(s => s.key === step);

  const goTo = useCallback((next: Step) => {
    const idx = steps.findIndex(s => s.key === next);
    setStep(next);
    setMaxStep(m => Math.max(m, idx));
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const profileText = useCallback((withHistory: boolean) => {
    if (!profile) return "";
    let text = `${profile.summary}\nSkills: ${profile.skills.join(", ")}\nExperience: ${profile.experience_years} years`;
    if (withHistory) text += `\n${JSON.stringify(profile.work_history)}`;
    return text;
  }, [profile]);

  // Restore an existing session on load
  useEffect(() => {
    const token = localStorage.getItem("cf_token");
    const check: Promise<boolean> = token
      ? fetch(`${API_BASE}/api/auth/check?token=${encodeURIComponent(token)}`)
          .then(r => r.json())
          .then(data => Boolean(data.authenticated))
      : Promise.resolve(false);
    check
      .catch(() => false)
      .then(ok => setAuth(ok ? "signed-in" : "signed-out"));
  }, []);

  const handleAuth = useCallback(async () => {
    if (!inviteCode.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("cf_token", data.token);
        setAuth("signed-in");
      } else {
        setAuthError("That invite code isn't valid. Check it and try again.");
      }
    } catch {
      setAuthError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setAuthLoading(false);
    }
  }, [inviteCode]);

  const handleLogout = () => {
    localStorage.removeItem("cf_token");
    setAuth("signed-out");
    setInviteCode("");
  };

  /** Shared wrapper: one busy flag per action, readable errors. */
  const run = useCallback(async (kind: Exclude<Busy, null>, path: string, form: FormData, onOk: (data: any) => void) => {
    setBusy(kind);
    setError(null);
    try {
      const res = await postWithRetry(`${API_BASE}${path}`, form, kind !== "apply");
      if ([502, 503, 504].includes(res.status)) throw new Error(NETWORK_ERROR);
      if (!res.ok) throw new Error(await readError(res));
      onOk(await res.json());
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }, []);

  const onProfileParsed = (data: Profile) => {
    setProfile(data);
    setJobs([]);
    setSearched(false);
    setSelectedJob(null);
    setGapAnalysis(null);
    setResumeRewrite(null);
    setInterviewPrep(null);
    setApplyResult(null);
    if (!targetRole && data.title) setTargetRole(data.title);
    goTo("discover");
  };

  const handleFileUpload = (file: File) => {
    const form = new FormData();
    form.append("resume", file);
    run("parse", "/api/profile/parse", form, onProfileParsed);
  };

  const handleTextParse = () => {
    if (!resumeText.trim()) return;
    const form = new FormData();
    form.append("resume_text", resumeText);
    run("parse", "/api/profile/parse-text", form, onProfileParsed);
  };

  const handleSearch = () => {
    if (!profile) return;
    const form = new FormData();
    form.append("query", searchQuery);
    form.append("limit", "30");
    form.append("resume_text", profileText(false));
    form.append("target_role", targetRole);
    form.append("target_industry", targetIndustry);
    form.append("sources", selectedSources.join(","));
    run("search", "/api/jobs/match", form, (data: Job[]) => {
      setJobs(data);
      setSearched(true);
      setGapAnalysis(null);
    });
  };

  const selectJob = (job: Job) => {
    if (selectedJob?.uuid === job.uuid) return;
    setSelectedJob(job);
    setResumeRewrite(null);
    setInterviewPrep(null);
    setApplyResult(null);
  };

  const handleGapAnalysis = () => {
    if (!profile) return;
    const form = new FormData();
    form.append("query", searchQuery);
    form.append("resume_text", profileText(false));
    form.append("target_role", targetRole);
    form.append("target_industry", targetIndustry);
    form.append("sources", selectedSources.join(","));
    run("gaps", "/api/gap-analysis", form, setGapAnalysis);
  };

  const handleResumeRewrite = () => {
    if (!profile || !selectedJob) return;
    const form = new FormData();
    form.append("resume_text", profileText(true));
    form.append("job_uuid", selectedJob.uuid);
    run("rewrite", "/api/resume/rewrite", form, setResumeRewrite);
  };

  const handleInterviewPrep = () => {
    if (!profile || !selectedJob) return;
    const form = new FormData();
    form.append("resume_text", profileText(false));
    form.append("job_uuid", selectedJob.uuid);
    run("interview", "/api/interview/prep", form, setInterviewPrep);
  };

  const handleApply = () => {
    if (!profile || !selectedJob) return;
    setApplyResult(null);
    const form = new FormData();
    form.append("job_url", selectedJob.job_url);
    form.append("resume_text", profileText(true));
    form.append("job_uuid", selectedJob.uuid);
    run("apply", "/api/apply", form, setApplyResult);
  };

  const handleDownloadResume = async () => {
    if (!profile || !selectedJob) return;
    setBusy("download");
    setError(null);
    try {
      const form = new FormData();
      form.append("resume_text", profileText(true));
      form.append("job_uuid", selectedJob.uuid);
      const res = await postWithRetry(`${API_BASE}/api/resume/generate-docx`, form);
      if ([502, 503, 504].includes(res.status)) throw new Error(NETWORK_ERROR);
      if (!res.ok) throw new Error(await readError(res));
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(profile.name || "Resume").replace(/\s+/g, "_")}_Resume.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || "Failed to generate resume");
    } finally {
      setBusy(null);
    }
  };

  // ─── Auth screens ──────────────────────────────────────────────

  if (auth === "checking") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-bg">
        <Loader2 className="w-6 h-6 text-muted animate-spin" />
      </div>
    );
  }

  if (auth === "signed-out") {
    return (
      <div className="min-h-dvh auth-backdrop flex flex-col">
        <div className="flex-1 grid lg:grid-cols-2">
          {/* Brand panel (desktop) */}
          <div className="hidden lg:flex flex-col justify-between p-12 border-r border-line bg-surface/60">
            <Logo />
            <div className="max-w-md">
              <h1 className="text-4xl font-semibold tracking-tight text-ink leading-tight">
                Your AI career copilot for Singapore.
              </h1>
              <p className="text-muted mt-4 text-[15px] leading-relaxed">
                From resume to offer: find roles that fit, close the skill gaps that matter, and walk into every
                interview prepared.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { icon: Search, title: "Matched jobs", text: "Live listings from MyCareersFuture and major portals, ranked against your profile." },
                  { icon: GraduationCap, title: "SkillsFuture-aware", text: "Course suggestions for the skills employers are asking for." },
                  { icon: FileText, title: "Tailored resumes", text: "ATS-optimised rewrites for each role, ready to download." },
                ].map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3">
                    <div className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                      <Icon className="w-[18px] h-[18px]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{title}</p>
                      <p className="text-sm text-muted">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-subtle">© {new Date().getFullYear()} CareerFlow SG</p>
          </div>

          {/* Sign-in form */}
          <div className="flex items-center justify-center px-4 py-12 sm:px-6">
            <div className="w-full max-w-sm animate-fade-in">
              <div className="lg:hidden flex flex-col items-center text-center mb-8">
                <LogoMark className="w-14 h-14 mb-4" />
                <h1 className="text-2xl font-semibold tracking-tight text-ink">CareerFlow SG</h1>
                <p className="text-sm text-muted mt-1">Your AI career copilot for Singapore</p>
              </div>

              <Card className="p-6 sm:p-7 shadow-raised">
                <div className="flex items-center gap-2 mb-1">
                  <Lock className="w-4 h-4 text-brand" />
                  <h2 className="text-lg font-semibold text-ink">Sign in</h2>
                </div>
                <p className="text-sm text-muted mb-5">CareerFlow is invite-only for now. Enter your invite code to continue.</p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAuth();
                  }}
                  className="space-y-3"
                >
                  <label htmlFor="invite" className="block text-sm font-medium text-ink">Invite code</label>
                  <input
                    id="invite"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="e.g. careerflow-xxxx"
                    className={inputClass}
                  />
                  {authError && (
                    <p className="flex items-start gap-1.5 text-sm text-danger">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {authError}
                    </p>
                  )}
                  <Button type="submit" block size="lg" loading={authLoading} disabled={!inviteCode.trim()}>
                    {authLoading ? "Verifying…" : "Continue"}
                    {!authLoading && <ArrowRight className="w-4 h-4" />}
                  </Button>
                </form>
              </Card>

              <p className="text-center text-xs text-subtle mt-6">
                Don&apos;t have a code? Ask the person who shared CareerFlow with you.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── App ───────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh flex flex-col bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Logo />
          <div className="flex items-center gap-2">
            {profile && (
              <div className="hidden sm:flex items-center gap-2 pr-2 mr-1 border-r border-line">
                <div className="w-8 h-8 rounded-full bg-brand-soft text-brand flex items-center justify-center text-xs font-semibold">
                  {(profile.name || "?").split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="leading-tight max-w-[180px]">
                  <p className="text-sm font-medium text-ink truncate">{profile.name}</p>
                  <p className="text-xs text-muted truncate">{profile.title}</p>
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} icon={<LogOut className="w-4 h-4" />} aria-label="Sign out">
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Stepper */}
        <nav aria-label="Progress" className="border-t border-line">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            {/* Mobile: compact progress */}
            <div className="md:hidden py-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-ink">{steps[stepIndex].label}</span>
                <span className="text-muted">Step {stepIndex + 1} of {steps.length}</span>
              </div>
              <div className="flex gap-1.5">
                {steps.map((s, i) => (
                  <button
                    key={s.key}
                    onClick={() => i <= maxStep && goTo(s.key)}
                    disabled={i > maxStep}
                    aria-label={s.label}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i <= stepIndex ? "bg-brand" : i <= maxStep ? "bg-line-strong" : "bg-line"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Desktop: full stepper */}
            <ol className="hidden md:flex items-center py-3">
              {steps.map((s, i) => {
                const Icon = s.icon;
                const isActive = i === stepIndex;
                const isDone = i < stepIndex || (i <= maxStep && i !== stepIndex);
                const reachable = i <= maxStep;
                return (
                  <li key={s.key} className="flex items-center flex-1 last:flex-none">
                    <button
                      onClick={() => reachable && goTo(s.key)}
                      disabled={!reachable}
                      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                        reachable ? "hover:bg-surface-2" : "cursor-not-allowed"
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                          isActive
                            ? "bg-brand text-on-brand"
                            : isDone
                              ? "bg-brand-soft text-brand"
                              : "bg-surface-2 text-subtle border border-line"
                        }`}
                      >
                        {isDone && !isActive ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                      </span>
                      <span className={`text-sm whitespace-nowrap ${isActive ? "font-semibold text-ink" : reachable ? "text-text" : "text-subtle"}`}>
                        {s.label}
                      </span>
                    </button>
                    {i < steps.length - 1 && (
                      <div className={`flex-1 h-px mx-2 ${i < maxStep ? "bg-brand/40" : "bg-line"}`} />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </nav>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {error && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger animate-fade-in">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="flex-1 break-words">{error}</p>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0 hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div key={step} className="animate-fade-in">
          {/* ─── Step 1: Profile ─── */}
          {step === "upload" && (
            <div className="max-w-2xl mx-auto">
              <PageHeader
                eyebrow="Step 1"
                title="Start with your resume"
                description="We'll read your experience and skills, then match you with roles across Singapore."
              />

              <label
                htmlFor="file-input"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && busy !== "parse") handleFileUpload(file);
                }}
                className={`block rounded-xl border-2 border-dashed px-6 py-10 sm:py-12 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:border-brand hover:bg-surface-2"
                }`}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".pdf,.txt"
                  className="sr-only"
                  disabled={busy === "parse"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />
                <div className="w-12 h-12 rounded-xl bg-brand-soft text-brand flex items-center justify-center mx-auto mb-4">
                  {busy === "parse" ? <Loader2 className="w-6 h-6 animate-spin" /> : <FileUp className="w-6 h-6" />}
                </div>
                <p className="text-[15px] font-semibold text-ink">
                  {busy === "parse" ? "Reading your resume…" : (
                    <>
                      <span className="text-brand">Choose a file</span>
                      <span className="hidden sm:inline"> or drag it here</span>
                    </>
                  )}
                </p>
                <p className="text-sm text-muted mt-1">PDF or TXT, up to 10 MB</p>
              </label>

              <div className="my-6 flex items-center gap-4">
                <div className="flex-1 h-px bg-line" />
                <span className="text-xs font-medium uppercase tracking-wider text-subtle">or paste text</span>
                <div className="flex-1 h-px bg-line" />
              </div>

              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste the contents of your resume here…"
                className={`${inputClass} h-48 py-3 resize-y leading-relaxed`}
              />
              <Button
                block
                size="lg"
                className="mt-4"
                onClick={handleTextParse}
                loading={busy === "parse"}
                disabled={!resumeText.trim() || busy !== null}
                icon={<Sparkles className="w-4 h-4" />}
              >
                {busy === "parse" ? "Analysing…" : "Analyse my profile"}
              </Button>
              <SlowNote show={busy === "parse"} />
            </div>
          )}

          {/* ─── Step 2: Discover ─── */}
          {step === "discover" && profile && (
            <div>
              <PageHeader
                eyebrow="Step 2"
                title="Find roles that fit"
                description={<>Matching for <span className="text-ink font-medium">{profile.name}</span> · {profile.title} · {profile.experience_years} yrs experience</>}
                action={
                  <Button variant="ghost" size="sm" onClick={() => goTo("upload")} icon={<ArrowLeft className="w-4 h-4" />}>
                    Change resume
                  </Button>
                }
              />

              <Card className="p-5 sm:p-6 mb-8">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
                  className="space-y-5"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="role" className="block text-sm font-medium text-ink mb-1.5">Target role</label>
                      <input
                        id="role"
                        type="text"
                        value={targetRole}
                        onChange={(e) => setTargetRole(e.target.value)}
                        placeholder="e.g. Product Manager"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="industry" className="block text-sm font-medium text-ink mb-1.5">
                        Industry <span className="text-subtle font-normal">(optional)</span>
                      </label>
                      <input
                        id="industry"
                        type="text"
                        value={targetIndustry}
                        onChange={(e) => setTargetIndustry(e.target.value)}
                        placeholder="e.g. Finance, Healthcare"
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-ink mb-2">Job sources</p>
                    <div className="flex flex-wrap gap-2">
                      {allSources.map(source => {
                        const on = selectedSources.includes(source.key);
                        return (
                          <button
                            key={source.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setSelectedSources(prev => (on ? prev.filter(s => s !== source.key) : [...prev, source.key]))
                            }
                            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
                              on
                                ? "border-brand bg-brand-soft text-brand"
                                : "border-line-strong bg-surface text-text hover:bg-surface-2"
                            }`}
                          >
                            {on && <Check className="w-3.5 h-3.5" />}
                            {source.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted mt-2">MyCareersFuture is fastest. Other portals find more roles but take longer.</p>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full sm:w-auto"
                    loading={busy === "search"}
                    disabled={!targetRole.trim() || selectedSources.length === 0 || busy !== null}
                    icon={<Search className="w-4 h-4" />}
                  >
                    {busy === "search" ? "Searching and ranking…" : "Find matching jobs"}
                  </Button>
                </form>
              </Card>

              {jobs.length > 0 ? (
                <div className="pb-24">
                  <div className="flex items-baseline justify-between mb-3">
                    <h3 className="text-base font-semibold text-ink">Top matches</h3>
                    <p className="text-sm text-muted">Showing {Math.min(jobs.length, 10)} of {jobs.length}</p>
                  </div>
                  <div className="space-y-3">
                    {jobs.slice(0, 10).map((job) => {
                      const selected = selectedJob?.uuid === job.uuid;
                      return (
                        <div
                          key={job.uuid}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectJob(job)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), selectJob(job))}
                          aria-pressed={selected}
                          className={`rounded-xl border bg-surface p-4 sm:p-5 shadow-card cursor-pointer transition-all outline-none focus-visible:ring-4 focus-visible:ring-brand-soft ${
                            selected ? "border-brand ring-4 ring-brand-soft" : "border-line hover:border-line-strong"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <h4 className="text-[15px] sm:text-base font-semibold text-ink">{job.title}</h4>
                                {job.source && job.source !== "mcf" && <Badge>{sourceLabel(job.source)}</Badge>}
                              </div>
                              <p className="text-sm text-text flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-subtle shrink-0" />
                                <span className="truncate">{job.company}</span>
                              </p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-sm text-muted">
                                {job.salary_min ? (
                                  <span className="flex items-center gap-1.5 text-ink font-medium">
                                    <Wallet className="w-3.5 h-3.5 text-success" />
                                    {money(job.salary_min)}{job.salary_max ? ` – ${money(job.salary_max)}` : ""}
                                    <span className="text-muted font-normal">/{(job.salary_type || "Monthly").toLowerCase() === "monthly" ? "mo" : job.salary_type}</span>
                                  </span>
                                ) : null}
                                {(job.district || job.region) && (
                                  <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{job.district || job.region}</span>
                                )}
                                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{job.experience_required}+ yrs</span>
                                {job.position_level && (
                                  <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" />{job.position_level}</span>
                                )}
                              </div>
                              {job.skills.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                  {job.skills.slice(0, 5).map((skill) => <Badge key={skill}>{skill}</Badge>)}
                                  {job.skills.length > 5 && <Badge>+{job.skills.length - 5}</Badge>}
                                </div>
                              )}
                            </div>
                            <ScoreRing score={job.match_score} label="match" />
                          </div>
                          <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-line">
                            {job.job_url ? (
                              <a
                                href={job.job_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
                              >
                                View posting <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            ) : <span />}
                            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${selected ? "text-brand" : "text-text"}`}>
                              {selected ? <><CheckCircle2 className="w-4 h-4" /> Selected</> : "Select this job"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : searched && busy !== "search" ? (
                <EmptyState
                  icon={<Search className="w-6 h-6" />}
                  title="No matching jobs found"
                  description="Try a broader role title, remove the industry, or add more job sources."
                />
              ) : busy !== "search" ? (
                <EmptyState
                  icon={<Briefcase className="w-6 h-6" />}
                  title="Your matches will appear here"
                  description="Set a target role and search. We'll rank each listing against your profile."
                />
              ) : (
                <Card className="px-6 py-12 text-center">
                  <Loader2 className="w-6 h-6 text-brand animate-spin mx-auto mb-3" />
                  <p className="text-sm font-medium text-ink">Searching listings and scoring matches…</p>
                  <p className="text-xs text-muted mt-1">This can take up to a minute when several sources are selected.</p>
                </Card>
              )}

              {/* Sticky continue bar */}
              {jobs.length > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
                  <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-muted min-w-0 truncate">
                      {selectedJob ? (
                        <><span className="text-ink font-medium">{selectedJob.title}</span><span className="hidden sm:inline"> · {selectedJob.company}</span></>
                      ) : "Select a job to tailor your resume"}
                    </p>
                    <Button onClick={() => goTo("gaps")} className="shrink-0">
                      Continue <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 3: Skill gaps ─── */}
          {step === "gaps" && (
            <div>
              <PageHeader
                eyebrow="Step 3"
                title="Close your skill gaps"
                description={<>What stands between your profile and <span className="text-ink font-medium">{targetRole || "your target role"}</span> roles in Singapore.</>}
              />

              {!gapAnalysis ? (
                <EmptyState
                  icon={<Target className="w-6 h-6" />}
                  title="Analyse the market for your target role"
                  description="We compare your skills against current listings and suggest SkillsFuture-eligible courses."
                  action={
                    <div>
                      <Button size="lg" onClick={handleGapAnalysis} loading={busy === "gaps"} disabled={busy !== null} icon={<Target className="w-4 h-4" />}>
                        {busy === "gaps" ? "Analysing…" : "Run gap analysis"}
                      </Button>
                      <SlowNote show={busy === "gaps"} />
                    </div>
                  }
                />
              ) : (
                <div className="space-y-6">
                  {gapAnalysis.salary_expectation && (
                    <Card>
                      <CardHeader icon={<Wallet className="w-[18px] h-[18px]" />} title="Expected salary" subtitle="Monthly, Singapore market" />
                      <div className="grid grid-cols-3 gap-px bg-line border-t border-line rounded-b-xl overflow-hidden">
                        {[
                          { label: "Low", value: gapAnalysis.salary_expectation.min },
                          { label: "Median", value: gapAnalysis.salary_expectation.median, highlight: true },
                          { label: "High", value: gapAnalysis.salary_expectation.max },
                        ].map(({ label, value, highlight }) => (
                          <div key={label} className="bg-surface px-3 py-4 sm:px-6 sm:py-5">
                            <p className="text-xs text-muted">{label}</p>
                            <p className={`mt-1 text-lg sm:text-2xl font-semibold tabular-nums ${highlight ? "text-brand" : "text-ink"}`}>
                              {money(value) || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                      <CardHeader icon={<Target className="w-[18px] h-[18px]" />} title="Missing skills" subtitle="Ranked by how often employers ask for them" />
                      <ul className="divide-y divide-line border-t border-line">
                        {gapAnalysis.missing_skills?.map((skill: any, i: number) => (
                          <li key={i} className="flex items-center justify-between gap-3 px-5 sm:px-6 py-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-ink truncate">{skill.skill}</span>
                              <Badge tone={levelTone(skill.urgency)}>{skill.urgency}</Badge>
                            </div>
                            {skill.found_in_jobs != null && (
                              <span className="text-xs text-muted whitespace-nowrap">in {skill.found_in_jobs} jobs</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Card>

                    <Card>
                      <CardHeader icon={<BookOpen className="w-[18px] h-[18px]" />} title="Recommended courses" subtitle="SkillsFuture eligible where noted" />
                      <ul className="divide-y divide-line border-t border-line">
                        {gapAnalysis.recommended_courses?.map((course: any, i: number) => (
                          <li key={i} className="px-5 sm:px-6 py-4">
                            <p className="text-sm font-medium text-ink">{course.name}</p>
                            <p className="text-sm text-muted">{course.provider}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted">
                              {course.duration && <span>{course.duration}</span>}
                              {course.estimated_cost != null && <span>{money(course.estimated_cost)}</span>}
                              {course.skillsfuture_subsidy && <Badge tone="success">{course.skillsfuture_subsidy}</Badge>}
                            </div>
                            {course.skills_covered?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {course.skills_covered.map((s: string) => <Badge key={s}>{s}</Badge>)}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>

                  {gapAnalysis.career_path_suggestions?.length > 0 && (
                    <Card>
                      <CardHeader icon={<TrendingUp className="w-[18px] h-[18px]" />} title="Career paths to consider" />
                      <ul className="space-y-2 px-5 sm:px-6 pb-5">
                        {gapAnalysis.career_path_suggestions.map((s: string, i: number) => <Bullet key={i}>{s}</Bullet>)}
                      </ul>
                    </Card>
                  )}

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                    <Button variant="secondary" onClick={() => goTo("discover")} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back to jobs
                    </Button>
                    <Button onClick={() => goTo("prepare")}>
                      Tailor my resume <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 4: Tailor resume ─── */}
          {step === "prepare" && (
            !selectedJob ? (
              <EmptyState
                icon={<Briefcase className="w-6 h-6" />}
                title="Pick a job first"
                description="Choose one of your matched jobs so we can tailor your resume to it."
                action={<Button onClick={() => goTo("discover")} icon={<ArrowLeft className="w-4 h-4" />}>Back to jobs</Button>}
              />
            ) : (
              <div>
                <PageHeader
                  eyebrow="Step 4"
                  title="Tailor your resume"
                  description={<>Optimised for <span className="text-ink font-medium">{selectedJob.title}</span> at <span className="text-ink font-medium">{selectedJob.company}</span></>}
                  action={
                    <Button variant="ghost" size="sm" onClick={() => goTo("discover")} icon={<ArrowLeft className="w-4 h-4" />}>
                      Choose another job
                    </Button>
                  }
                />

                {!resumeRewrite ? (
                  <EmptyState
                    icon={<FileText className="w-6 h-6" />}
                    title="Rewrite your resume for this role"
                    description="We'll rewrite your summary and achievements around the job's requirements and add the keywords applicant tracking systems look for."
                    action={
                      <div>
                        <Button size="lg" onClick={handleResumeRewrite} loading={busy === "rewrite"} disabled={busy !== null} icon={<Sparkles className="w-4 h-4" />}>
                          {busy === "rewrite" ? "Rewriting…" : "Tailor my resume"}
                        </Button>
                        <SlowNote show={busy === "rewrite"} />
                      </div>
                    }
                  />
                ) : (
                  <div className="space-y-6">
                    <Card className="p-5 sm:p-6">
                      <div className="flex items-center gap-5">
                        <ScoreRing score={resumeRewrite.ats_score} size={72} />
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-semibold text-ink">ATS match score</h3>
                          <p className="text-sm text-muted mt-0.5">How well the tailored resume lines up with this job&apos;s keywords and requirements.</p>
                        </div>
                      </div>
                      {resumeRewrite.keywords_added?.length > 0 && (
                        <div className="mt-5 pt-5 border-t border-line">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted mb-2">Keywords added</p>
                          <div className="flex flex-wrap gap-1.5">
                            {resumeRewrite.keywords_added.map((kw: string) => <Badge key={kw} tone="brand">{kw}</Badge>)}
                          </div>
                        </div>
                      )}
                    </Card>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Card className="p-5 sm:p-6">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted mb-2">Original summary</p>
                        <p className="text-sm text-muted leading-relaxed">{resumeRewrite.original_summary}</p>
                      </Card>
                      <Card className="p-5 sm:p-6 border-brand/40">
                        <p className="text-xs font-medium uppercase tracking-wider text-brand mb-2">Tailored summary</p>
                        <p className="text-sm text-ink leading-relaxed">{resumeRewrite.rewritten_summary}</p>
                      </Card>
                    </div>

                    {resumeRewrite.optimized_bullets?.length > 0 && (
                      <Card>
                        <CardHeader icon={<Sparkles className="w-[18px] h-[18px]" />} title="Rewritten achievements" />
                        <ul className="space-y-3 px-5 sm:px-6 pb-6">
                          {resumeRewrite.optimized_bullets.map((b: string, i: number) => <Bullet key={i}>{b}</Bullet>)}
                        </ul>
                      </Card>
                    )}

                    <Card className="p-5 sm:p-6">
                      <h3 className="text-[15px] font-semibold text-ink">Next steps</h3>
                      <p className="text-sm text-muted mt-0.5 mb-4">Download your tailored resume, apply, or get ready for the interview.</p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Button variant="secondary" onClick={handleDownloadResume} loading={busy === "download"} disabled={busy !== null} icon={<Download className="w-4 h-4" />}>
                          {busy === "download" ? "Generating…" : "Download .docx"}
                        </Button>
                        <Button variant="secondary" onClick={handleApply} loading={busy === "apply"} disabled={busy !== null || !selectedJob.job_url} icon={<Send className="w-4 h-4" />}>
                          {busy === "apply" ? "Applying…" : "Auto-apply"}
                        </Button>
                        <Button onClick={() => goTo("interview")}>
                          Interview prep <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>

                      {applyResult && (
                        <div className={`mt-5 rounded-lg border p-4 ${applyResult.success ? "border-success/30 bg-success-soft" : "border-warning/30 bg-warning-soft"}`}>
                          <p className={`flex items-center gap-2 text-sm font-semibold ${applyResult.success ? "text-success" : "text-warning"}`}>
                            {applyResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                            {applyResult.success ? "Application submitted" : "Application needs your attention"}
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-text">
                            {applyResult.steps?.map((s: string, i: number) => <li key={i} className="break-words">• {s}</li>)}
                            {applyResult.errors?.map((e: string, i: number) => <li key={`e${i}`} className="text-danger break-words">• {e}</li>)}
                          </ul>
                        </div>
                      )}
                    </Card>
                  </div>
                )}
              </div>
            )
          )}

          {/* ─── Step 5: Interview ─── */}
          {step === "interview" && (
            !selectedJob ? (
              <EmptyState
                icon={<Briefcase className="w-6 h-6" />}
                title="Pick a job first"
                description="Interview prep is tailored to a specific role and company."
                action={<Button onClick={() => goTo("discover")} icon={<ArrowLeft className="w-4 h-4" />}>Back to jobs</Button>}
              />
            ) : (
              <div>
                <PageHeader
                  eyebrow="Step 5"
                  title="Prepare for the interview"
                  description={<>For <span className="text-ink font-medium">{selectedJob.title}</span> at <span className="text-ink font-medium">{selectedJob.company}</span></>}
                />

                {!interviewPrep ? (
                  <EmptyState
                    icon={<MessageSquare className="w-6 h-6" />}
                    title="Generate your interview pack"
                    description="Likely behavioural and technical questions, company research and salary negotiation tips."
                    action={
                      <div>
                        <Button size="lg" onClick={handleInterviewPrep} loading={busy === "interview"} disabled={busy !== null} icon={<Sparkles className="w-4 h-4" />}>
                          {busy === "interview" ? "Preparing…" : "Generate interview prep"}
                        </Button>
                        <SlowNote show={busy === "interview"} />
                      </div>
                    }
                  />
                ) : (
                  <div className="space-y-6">
                    {interviewPrep.behavioral_questions?.length > 0 && (
                      <Card>
                        <CardHeader icon={<MessageSquare className="w-[18px] h-[18px]" />} title="Behavioural questions" subtitle="Answer with the STAR method: Situation, Task, Action, Result" />
                        <ol className="divide-y divide-line border-t border-line">
                          {interviewPrep.behavioral_questions.map((q: any, i: number) => (
                            <li key={i} className="flex gap-3 sm:gap-4 px-5 sm:px-6 py-4">
                              <span className="w-7 h-7 rounded-full bg-surface-2 border border-line text-xs font-semibold text-muted flex items-center justify-center shrink-0">
                                {i + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink">{q.question}</p>
                                {q.why_asked && <p className="text-sm text-muted mt-1">Why they ask: {q.why_asked}</p>}
                                {q.star_framework_hint && (
                                  <p className="mt-2.5 flex gap-2 rounded-lg bg-brand-soft px-3 py-2.5 text-sm text-text">
                                    <Lightbulb className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                                    <span>{q.star_framework_hint}</span>
                                  </p>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </Card>
                    )}

                    {interviewPrep.technical_questions?.length > 0 && (
                      <Card>
                        <CardHeader icon={<Target className="w-[18px] h-[18px]" />} title="Technical questions" />
                        <ul className="divide-y divide-line border-t border-line">
                          {interviewPrep.technical_questions.map((q: any, i: number) => (
                            <li key={i} className="flex items-start justify-between gap-3 px-5 sm:px-6 py-3.5">
                              <div className="min-w-0">
                                {q.topic && <p className="text-xs text-muted mb-0.5">{q.topic}</p>}
                                <p className="text-sm font-medium text-ink">{q.question}</p>
                              </div>
                              {q.difficulty && <Badge tone={levelTone(q.difficulty)}>{q.difficulty}</Badge>}
                            </li>
                          ))}
                        </ul>
                      </Card>
                    )}

                    {interviewPrep.company_research && (
                      <Card>
                        <CardHeader icon={<Building2 className="w-[18px] h-[18px]" />} title={`About ${selectedJob.company}`} />
                        <div className="grid gap-6 md:grid-cols-3 px-5 sm:px-6 pb-6">
                          {[
                            { title: "Key facts", items: interviewPrep.company_research.key_facts },
                            { title: "Recent news", items: interviewPrep.company_research.recent_news },
                            { title: "Culture", items: interviewPrep.company_research.culture_notes },
                          ].map(({ title, items }) => (
                            <div key={title}>
                              <p className="text-xs font-medium uppercase tracking-wider text-muted mb-2">{title}</p>
                              <ul className="space-y-1.5">
                                {(items || []).map((t: string, i: number) => (
                                  <li key={i} className="text-sm text-text leading-relaxed flex gap-2">
                                    <span className="text-brand">•</span><span>{t}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {interviewPrep.negotiation_tips?.length > 0 && (
                      <Card>
                        <CardHeader icon={<ShieldCheck className="w-[18px] h-[18px]" />} title="Salary negotiation tips" subtitle="For the Singapore market" />
                        <ul className="space-y-3 px-5 sm:px-6 pb-6">
                          {interviewPrep.negotiation_tips.map((tip: string, i: number) => <Bullet key={i}>{tip}</Bullet>)}
                        </ul>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </main>

      <footer className={`border-t border-line ${step === "discover" && jobs.length > 0 ? "pb-20" : ""}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted">
          <p>© {new Date().getFullYear()} CareerFlow SG</p>
          <p>Job data from MyCareersFuture · AI by GPT-OSS 120B via Groq</p>
        </div>
      </footer>
    </div>
  );
}
