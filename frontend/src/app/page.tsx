"use client";
import { useState, useCallback, useEffect, type ReactNode } from "react";
import {
  Upload, Search, TrendingUp, FileText, MessageSquare, Sparkles, ArrowRight, ArrowLeft, CheckCircle2,
  Loader2, Briefcase, MapPin, Clock, Target, Lock, LogOut, ExternalLink,
  Wallet, FileUp, Building2, Lightbulb, ShieldCheck, Check, AlertTriangle, X, GraduationCap,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/Logo";
import { ProfileEditor, emptyContact, missingApplyDetails, type Profile } from "@/components/ProfileEditor";
import { TailorWorkspace } from "@/components/TailorWorkspace";
import { SkillGaps, type GapResult } from "@/components/SkillGaps";
import { API_BASE, NETWORK_ERROR, postWithRetry, readError } from "@/lib/api";
import type { Job, Tailored, ResumeDoc } from "@/lib/types";
import {
  Button, Card, CardHeader, Badge, ScoreRing, PageHeader, EmptyState, inputClass, levelTone,
} from "@/components/ui";

type Step = "upload" | "discover" | "gaps" | "prepare" | "interview";
type Busy = "parse" | "search" | "gaps" | "interview" | "apply" | null;
type AuthState = "checking" | "signed-out" | "signed-in";

const DEVELOPER_LINKEDIN = "https://www.linkedin.com/in/bertramyang";
const PROFILE_KEY = "cf_profile";
const PAGE_SIZE = 10;
const MAX_SELECTED = 5;  // free AI tiers: tailoring is one resume at a time

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
  const [setupIssues, setSetupIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [resumeText, setResumeText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Restored from this browser (if saved) when the page state is created
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem(PROFILE_KEY);
      return saved ? { ...emptyContact, ...JSON.parse(saved) } : null;
    } catch {
      return null;
    }
  });
  const [uploadMode, setUploadMode] = useState(false);
  const [highlightDetails, setHighlightDetails] = useState<string[]>([]);

  const [targetRole, setTargetRole] = useState(() => profile?.title ?? "");
  const [targetIndustry, setTargetIndustry] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>(["mcf"]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searched, setSearched] = useState(false);
  const [minSalary, setMinSalary] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [selectedJobs, setSelectedJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const selectedJob = selectedJobs.find(j => j.uuid === activeJobId) ?? selectedJobs[0] ?? null;
  const [tailored, setTailored] = useState<Record<string, Tailored>>({});
  const [template, setTemplateState] = useState(() => {
    if (typeof window === "undefined") return "ats";
    try { return localStorage.getItem("cf_template") || "ats"; } catch { return "ats"; }
  });
  const setTemplate = (t: string) => {
    setTemplateState(t);
    try { localStorage.setItem("cf_template", t); } catch {}
  };

  const [gapAnalysis, setGapAnalysis] = useState<GapResult | null>(null);
  const [interviewPreps, setInterviewPreps] = useState<Record<string, any>>({});
  const interviewPrep = selectedJob ? interviewPreps[selectedJob.uuid] : null;
  const [applyResult, setApplyResult] = useState<any>(null);

  const stepIndex = steps.findIndex(s => s.key === step);

  const goTo = useCallback((next: Step) => {
    const idx = steps.findIndex(s => s.key === next);
    setStep(next);
    setMaxStep(m => Math.max(m, idx));
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /** Every AI step receives the structured profile, so nothing is re-parsed or lost. */
  const withProfile = useCallback((form: FormData) => {
    if (profile) form.append("profile_json", JSON.stringify(profile));
    return form;
  }, [profile]);

  // Keep the profile (incl. My details) in this browser only, across reloads
  useEffect(() => {
    try {
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {}
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

    // Workshop-friendly: say clearly if the backend's AI key or SkillsFuture data isn't set up
    fetch(`${API_BASE}/health`).then(r => r.json()).then(h => {
      const issues: string[] = [];
      if (!h.llm_configured) issues.push("No AI key is set up. Copy backend/.env.example to backend/.env, paste your key after MODEL_API_KEY=, and restart the backend.");
      if (h.skills_framework === false) issues.push("SkillsFuture skill-gap data isn't downloaded yet. In the backend folder run: python data/build_skills_framework.py --download");
      setSetupIssues(issues);
    }).catch(() => setSetupIssues(["Can't reach the backend at " + API_BASE + ". Is it running? (see README: Start the app)"]));

    const onSignedOut = () => {
      setAuth("signed-out");
      setAuthError("Your session has ended. Please enter your invite code again.");
    };
    window.addEventListener("cf:signed-out", onSignedOut);
    return () => window.removeEventListener("cf:signed-out", onSignedOut);
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
    setProfile({ ...emptyContact, ...data });
    setUploadMode(false);
    setJobs([]);
    setSearched(false);
    setSelectedJobs([]);
    setTailored({});
    setGapAnalysis(null);
    setInterviewPreps({});
    setApplyResult(null);
    if (data.title) setTargetRole(data.title);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    const form = withProfile(new FormData());
    form.append("query", targetRole);
    form.append("limit", "200");
    form.append("target_role", targetRole);
    form.append("target_industry", targetIndustry);
    form.append("sources", selectedSources.join(","));
    form.append("min_salary", minSalary);
    form.append("employment_type", employmentType);
    run("search", "/api/jobs/match", form, (data: Job[]) => {
      setJobs(data);
      setSearched(true);
      setShowCount(PAGE_SIZE);
      setGapAnalysis(null);
    });
  };

  const toggleJob = (job: Job) => {
    setError(null);
    setSelectedJobs(prev => {
      if (prev.some(j => j.uuid === job.uuid)) return prev.filter(j => j.uuid !== job.uuid);
      if (prev.length >= MAX_SELECTED) {
        setError(`You can tailor up to ${MAX_SELECTED} resumes at a time. Deselect one first.`);
        return prev;
      }
      return [...prev, job];
    });
    setApplyResult(null);
  };

  const handleInterviewPrep = () => {
    if (!profile || !selectedJob) return;
    const form = withProfile(new FormData());
    form.append("job_uuid", selectedJob.uuid);
    form.append("job_json", JSON.stringify(selectedJob));
    const id = selectedJob.uuid;
    run("interview", "/api/interview/prep", form, (data) => setInterviewPreps(prev => ({ ...prev, [id]: data })));
  };

  /** Assisted apply: opens a visible browser, fills your details, attaches the resume. You submit. */
  const handleApply = (job: Job | null, resume?: ResumeDoc, resumeTemplate = template) => {
    if (!profile || !job) return;
    const missing = missingApplyDetails(profile);
    if (missing.length) {
      // Never apply with made-up details: send them to My details first
      setHighlightDetails(missing);
      setUploadMode(false);
      goTo("upload");
      setError(`Add your ${missing.join(", ")} in My details, then come back to apply.`);
      return;
    }
    setApplyResult(null);
    const form = withProfile(new FormData());
    form.append("job_url", job.job_url);
    if (resume) form.append("resume_json", JSON.stringify(resume));
    form.append("template", resumeTemplate);
    form.append("job_uuid", job.uuid);
    form.append("job_json", JSON.stringify(job));
    run("apply", "/api/apply", form, setApplyResult);
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
            <p className="text-xs text-subtle">
              © {new Date().getFullYear()} CareerFlow SG · Developed by{" "}
              <a href={DEVELOPER_LINKEDIN} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Bertram Yang</a>
            </p>
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
                    placeholder="Enter your invite code"
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
              <p className="text-center text-sm text-muted mt-4">
                CareerFlow SG is developed by{" "}
                <a
                  href={DEVELOPER_LINKEDIN}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand hover:underline"
                >
                  Bertram Yang
                </a>
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
        {setupIssues.length > 0 && (
          <div className="mb-6 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-text">
            <p className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle className="w-4 h-4" /> Setup needed</p>
            <ul className="mt-1.5 space-y-1 list-disc pl-5">{setupIssues.map(i => <li key={i}>{i}</li>)}</ul>
          </div>
        )}

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
          {step === "upload" && profile && !uploadMode && (
            <div className="max-w-3xl mx-auto">
              <PageHeader
                eyebrow="Step 1"
                title="Check your profile"
                description="This is what CareerFlow read from your resume. Fix anything that's wrong; every later step uses it."
              />
              <ProfileEditor
                profile={profile}
                onChange={(p) => {
                  setProfile(p);
                  if (highlightDetails.length) setHighlightDetails(missingApplyDetails(p).filter(k => highlightDetails.includes(k)));
                }}
                onContinue={() => goTo("discover")}
                onReupload={() => setUploadMode(true)}
                highlight={highlightDetails}
              />
            </div>
          )}

          {step === "upload" && (!profile || uploadMode) && (
            <div className="max-w-2xl mx-auto">
              <PageHeader
                eyebrow="Step 1"
                title="Start with your resume"
                description="We'll read your experience and skills, then match you with roles across Singapore."
                action={profile ? (
                  <Button variant="ghost" size="sm" onClick={() => setUploadMode(false)} icon={<ArrowLeft className="w-4 h-4" />}>
                    Back to my profile
                  </Button>
                ) : undefined}
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
                    Edit profile
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

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="min-salary" className="block text-sm font-medium text-ink mb-1.5">
                        Minimum monthly salary <span className="text-subtle font-normal">(optional)</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">S$</span>
                        <input
                          id="min-salary"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={100}
                          value={minSalary}
                          onChange={(e) => setMinSalary(e.target.value)}
                          placeholder="e.g. 4000"
                          className={`${inputClass} pl-10`}
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="emp-type" className="block text-sm font-medium text-ink mb-1.5">Employment type</label>
                      <select
                        id="emp-type"
                        value={employmentType}
                        onChange={(e) => setEmploymentType(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Any</option>
                        <option value="Full Time">Full time</option>
                        <option value="Permanent">Permanent</option>
                        <option value="Contract">Contract</option>
                        <option value="Part Time">Part time</option>
                        <option value="Internship/Attachment">Internship</option>
                      </select>
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
                    <p className="text-sm text-muted">Showing {Math.min(jobs.length, showCount)} of {jobs.length} ranked</p>
                  </div>
                  <p className="text-xs text-muted mb-4">
                    Ranked by title fit, your skills, experience and salary. The top {jobs.filter(j => j.ai_ranked).length} were
                    also reviewed by AI, which explains each match.
                  </p>
                  <div className="space-y-3">
                    {jobs.slice(0, showCount).map((job) => {
                      const selected = selectedJobs.some(j => j.uuid === job.uuid);
                      return (
                        <div
                          key={job.uuid}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleJob(job)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleJob(job))}
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
                              {job.match_reason && (
                                <p className="mt-3 flex gap-2 text-sm text-text leading-relaxed">
                                  <Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                                  <span>{job.match_reason}</span>
                                </p>
                              )}
                              {(job.matched_skills?.length > 0 || job.missing_skills?.length > 0) && (
                                <div className="mt-3 space-y-1.5">
                                  {job.matched_skills?.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-xs text-muted w-16 shrink-0">You have</span>
                                      {job.matched_skills.slice(0, 6).map(s => <Badge key={s} tone="success">{s}</Badge>)}
                                    </div>
                                  )}
                                  {job.missing_skills?.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-xs text-muted w-16 shrink-0">To build</span>
                                      {job.missing_skills.slice(0, 4).map(s => <Badge key={s} tone="warning">{s}</Badge>)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <ScoreRing score={job.match_score} label={job.ai_ranked ? "AI checked" : "match"} />
                          </div>
                          {job.score_breakdown && (
                            <p className="mt-3 text-xs text-muted">
                              Title {job.score_breakdown.title ?? "–"} · Skills {job.score_breakdown.skills ?? "–"} ·
                              Experience {job.score_breakdown.experience ?? "–"} · Salary {job.score_breakdown.salary ?? "–"}
                              {job.score_breakdown.experience_note && <> · {job.score_breakdown.experience_note}</>}
                              {job.score_breakdown.ai != null && <> · AI score {job.score_breakdown.ai}</>}
                            </p>
                          )}
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
                              <span className={`w-5 h-5 rounded border flex items-center justify-center ${
                                selected ? "bg-brand border-brand text-on-brand" : "border-line-strong"}`}>
                                {selected && <Check className="w-3.5 h-3.5" />}
                              </span>
                              {selected ? "Selected" : "Select"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {showCount < jobs.length && (
                    <div className="mt-4 flex justify-center">
                      <Button variant="secondary" onClick={() => setShowCount(c => c + PAGE_SIZE)}>
                        Show {Math.min(PAGE_SIZE, jobs.length - showCount)} more
                      </Button>
                    </div>
                  )}
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
                      {selectedJobs.length
                        ? <><span className="text-ink font-medium">{selectedJobs.length} job{selectedJobs.length > 1 ? "s" : ""} selected</span><span className="hidden sm:inline"> (max {MAX_SELECTED})</span></>
                        : "Select the jobs you want to apply for"}
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="secondary" onClick={() => goTo("gaps")} className="hidden sm:inline-flex">Check skill gaps</Button>
                      <Button onClick={() => goTo("prepare")} disabled={!selectedJobs.length}>
                        Tailor resumes <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 3              )}
            </div>
          )}

          {/* ─── Step 3: Skill gaps (optional) ─── */}
          {step === "gaps" && profile && (
            <div>
              <PageHeader
                eyebrow="Step 3 · optional"
                title="Close your skill gaps"
                description={<>How your skills compare with what Singapore&apos;s Skills Framework says a <span className="text-ink font-medium">{targetRole || profile.title}</span> needs.</>}
                action={
                  <Button variant="secondary" size="sm" onClick={() => goTo("prepare")}>
                    {gapAnalysis ? "Continue" : "Skip"} to tailoring <ArrowRight className="w-4 h-4" />
                  </Button>
                }
              />
              <SkillGaps
                profile={profile}
                targetRole={targetRole || profile.title}
                targetIndustry={targetIndustry}
                jobs={jobs}
                result={gapAnalysis}
                setResult={setGapAnalysis}
                onContinue={() => goTo("prepare")}
                onError={setError}
              />
            </div>
          )}

          {/* ─── Step 4: Tailor resumes ─── */}
          {step === "prepare" && profile && (
            <div>
              <PageHeader
                eyebrow="Step 4"
                title="Tailor your resumes"
                description="One resume per job, written to pass ATS screening. Edit anything, then download."
                action={
                  <Button variant="ghost" size="sm" onClick={() => goTo("discover")} icon={<ArrowLeft className="w-4 h-4" />}>
                    Change jobs
                  </Button>
                }
              />
              <TailorWorkspace
                jobs={selectedJobs}
                profile={profile}
                tailored={tailored}
                setTailored={setTailored}
                template={template}
                setTemplate={setTemplate}
                activeJobId={selectedJob?.uuid ?? null}
                setActiveJobId={(id) => { setActiveJobId(id); setApplyResult(null); }}
                onInterview={() => goTo("interview")}
                onApply={(job, resume, t) => handleApply(job, resume, t)}
                applying={busy === "apply"}
                applyResult={applyResult}
                onBackToJobs={() => goTo("discover")}
                onError={setError}
              />
            </div>
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
                  action={selectedJobs.length > 1 ? (
                    <select
                      aria-label="Choose a job"
                      value={selectedJob.uuid}
                      onChange={(e) => setActiveJobId(e.target.value)}
                      className={`${inputClass} h-9 text-sm max-w-[260px]`}
                    >
                      {selectedJobs.map(j => <option key={j.uuid} value={j.uuid}>{j.title} · {j.company}</option>)}
                    </select>
                  ) : undefined}
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
          <p>Job data from MyCareersFuture · Powered by the LLM of your choice</p>
        </div>
      </footer>
    </div>
  );
}
