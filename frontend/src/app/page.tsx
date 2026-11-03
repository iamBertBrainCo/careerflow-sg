"use client";
import { useState, useCallback, useEffect } from "react";
import { Upload, Search, TrendingUp, FileText, MessageSquare, Sparkles, ArrowRight, CheckCircle, Loader2, Briefcase, MapPin, DollarSign, Clock, Star, BookOpen, Target, Lock, Send, Download } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type Step = "upload" | "discover" | "gaps" | "prepare" | "interview";

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

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [targetIndustry, setTargetIndustry] = useState("");
  // Derived search query combining role and industry
  const searchQuery = `${targetRole} ${targetIndustry}`.trim();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [resumeRewrite, setResumeRewrite] = useState<any>(null);
  const [interviewPrep, setInterviewPrep] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>(["mcf"]);

  const allSources = [
    { key: "mcf", label: "MyCareersFuture", color: "text-green-400", bg: "bg-green-500/20" },
    { key: "jobstreet", label: "JobStreet", color: "text-blue-400", bg: "bg-blue-500/20" },
    { key: "indeed", label: "Indeed SG", color: "text-indigo-400", bg: "bg-indigo-500/20" },
    { key: "linkedin", label: "LinkedIn", color: "text-sky-400", bg: "bg-sky-500/20" },
    { key: "glassdoor", label: "Glassdoor", color: "text-emerald-400", bg: "bg-emerald-500/20" },
  ];

  const toggleSource = (key: string) => {
    setSelectedSources(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    );
  };

  // Check for existing auth token on load
  useEffect(() => {
    const token = localStorage.getItem("cf_token");
    if (token) {
      fetch(`${API_BASE}/api/auth/check?token=${token}`)
        .then(r => r.json())
        .then(data => {
          if (data.authenticated) setAuthenticated(true);
        })
        .catch(() => {});
    }
  }, []);

  const handleAuth = useCallback(async () => {
    if (!inviteCode.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code: inviteCode }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("cf_token", data.token);
        setAuthenticated(true);
      } else {
        setAuthError("Invalid invite code. Please check and try again.");
      }
    } catch (e: any) {
      setAuthError("Failed to verify. Check your connection.");
    } finally {
      setAuthLoading(false);
    }
  }, [inviteCode]);

  const steps: { key: Step; label: string; icon: any; description: string }[] = [
    { key: "upload", label: "Profile", icon: Upload, description: "Upload your resume" },
    { key: "discover", label: "Discover", icon: Search, description: "Find matching jobs" },
    { key: "gaps", label: "Gap Analysis", icon: TrendingUp, description: "Close skill gaps" },
    { key: "prepare", label: "Prepare", icon: FileText, description: "Rewrite your resume" },
    { key: "interview", label: "Interview", icon: MessageSquare, description: "Practice & ace it" },
  ];

  const stepIndex = steps.findIndex(s => s.key === step);

  const handleFileUpload = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("resume", file);
      const res = await fetch(`${API_BASE}/api/profile/parse`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProfile(data);
      setStep("discover");
    } catch (e: any) {
      setError(e.message || "Failed to parse resume");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTextParse = useCallback(async () => {
    if (!resumeText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("resume_text", resumeText);
      const res = await fetch(`${API_BASE}/api/profile/parse-text`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProfile(data);
      setStep("discover");
    } catch (e: any) {
      setError(e.message || "Failed to parse resume");
    } finally {
      setLoading(false);
    }
  }, [resumeText]);

  const handleSearch = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("query", searchQuery);
      formData.append("limit", "30");
      formData.append("resume_text", profile.summary + "\nSkills: " + profile.skills.join(", ") + "\nExperience: " + profile.experience_years + " years");
      formData.append("target_role", targetRole);
      formData.append("target_industry", targetIndustry);
      formData.append("sources", selectedSources.join(","));
      const res = await fetch(`${API_BASE}/api/jobs/match`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setJobs(data);
      setStep("gaps");
    } catch (e: any) {
      setError(e.message || "Failed to search jobs");
    } finally {
      setLoading(false);
    }
  }, [profile, searchQuery, targetRole, targetIndustry, selectedSources]);

  const handleGapAnalysis = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("query", searchQuery);
      formData.append("resume_text", profile.summary + "\nSkills: " + profile.skills.join(", ") + "\nExperience: " + profile.experience_years + " years");
      formData.append("target_role", targetRole);
      formData.append("target_industry", targetIndustry);
      formData.append("sources", selectedSources.join(","));
      const res = await fetch(`${API_BASE}/api/gap-analysis`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGapAnalysis(data);
    } catch (e: any) {
      setError(e.message || "Failed to analyze gaps");
    } finally {
      setLoading(false);
    }
  }, [profile, searchQuery, targetRole, targetIndustry, selectedSources]);

  const handleResumeRewrite = useCallback(async (job: Job) => {
    if (!profile) return;
    setSelectedJob(job);
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("resume_text", profile.summary + "\nSkills: " + profile.skills.join(", ") + "\nExperience: " + profile.experience_years + " years\n" + JSON.stringify(profile.work_history));
      formData.append("job_uuid", job.uuid);
      const res = await fetch(`${API_BASE}/api/resume/rewrite`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResumeRewrite(data);
      setStep("interview");
    } catch (e: any) {
      setError(e.message || "Failed to rewrite resume");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const handleInterviewPrep = useCallback(async (job: Job) => {
    if (!profile) return;
    setSelectedJob(job);
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("resume_text", profile.summary + "\nSkills: " + profile.skills.join(", ") + "\nExperience: " + profile.experience_years + " years");
      formData.append("job_uuid", job.uuid);
      const res = await fetch(`${API_BASE}/api/interview/prep`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInterviewPrep(data);
    } catch (e: any) {
      setError(e.message || "Failed to generate interview prep");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const handleApply = useCallback(async (job: Job) => {
    if (!profile) return;
    setApplying(true);
    setApplyResult(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("job_url", job.job_url);
      formData.append("resume_text", profile.summary + "\nSkills: " + profile.skills.join(", ") + "\nExperience: " + profile.experience_years + " years\n" + JSON.stringify(profile.work_history));
      formData.append("job_uuid", job.uuid);
      const res = await fetch(`${API_BASE}/api/apply`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setApplyResult(data);
    } catch (e: any) {
      setError(e.message || "Failed to apply");
    } finally {
      setApplying(false);
    }
  }, [profile]);

  const handleDownloadResume = useCallback(async () => {
    if (!profile || !selectedJob) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("resume_text", profile.summary + "\nSkills: " + profile.skills.join(", ") + "\nExperience: " + profile.experience_years + " years\n" + JSON.stringify(profile.work_history));
      formData.append("job_uuid", selectedJob.uuid);
      const res = await fetch(`${API_BASE}/api/resume/generate-docx`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${profile.name.replace(' ', '_')}_Resume.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || "Failed to generate resume");
    } finally {
      setLoading(false);
    }
  }, [profile, selectedJob]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-300">
      {/* Auth Screen */}
      {!authenticated ? (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="max-w-md w-full">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">CareerFlow SG</h1>
              <p className="text-zinc-400">Autonomous Career Agent for Singapore</p>
            </div>

            <div className="gradient-border p-8">
              <div className="flex items-center gap-3 mb-6">
                <Lock className="w-5 h-5 text-indigo-400" />
                <h2 className="text-xl font-semibold text-white">Invite Only Access</h2>
              </div>
              <p className="text-zinc-400 text-sm mb-6">
                Enter your invite code to access CareerFlow. Codes are distributed by the admin.
              </p>

              {authError && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {authError}
                </div>
              )}

              <div className="space-y-4">
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                  placeholder="Enter invite code..."
                  className="w-full px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleAuth}
                  disabled={authLoading || !inviteCode.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                  {authLoading ? "Verifying..." : "Access CareerFlow"}
                </button>
              </div>
            </div>

            <p className="text-center text-xs text-zinc-600 mt-6">
              Built for Meta AI Hackathon 2026 · Powered by Groq Llama 3.3
            </p>
          </div>
        </div>
      ) : (
        <>
      {/* Header */}
      <header className="border-b border-zinc-800/50 backdrop-blur-sm sticky top-0 z-50 bg-[#0a0a0f]/80">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white glow-text">CareerFlow SG</h1>
              <p className="text-xs text-zinc-500">Meta AI Hackathon 2026</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span className="px-2 py-1 rounded-full bg-zinc-800 text-xs">Indie Track</span>
            <span className="px-2 py-1 rounded-full bg-zinc-800 text-xs">🇸🇬 Singapore</span>
            <button
              onClick={() => {
                localStorage.removeItem("cf_token");
                setAuthenticated(false);
              }}
              className="px-2 py-1 rounded-full bg-zinc-800 text-xs hover:bg-zinc-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Step Navigation */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-12">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === stepIndex;
            const isComplete = i < stepIndex;
            return (
              <div key={s.key} className="flex items-center">
                <button
                  onClick={() => i <= stepIndex && setStep(s.key)}
                  className={`flex flex-col items-center gap-2 transition-all ${
                    i <= stepIndex ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                  }`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                    isActive ? "step-active glow animate-pulse-glow" :
                    isComplete ? "step-complete" : "step-pending"
                  }`}>
                    {isComplete ? <CheckCircle className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
                  </div>
                  <span className={`text-xs font-medium ${isActive ? "text-indigo-400" : "text-zinc-500"}`}>
                    {s.label}
                  </span>
                </button>
                {i < steps.length - 1 && (
                  <div className={`w-16 sm:w-24 h-0.5 mx-2 ${
                    i < stepIndex ? "bg-green-500" : "bg-zinc-800"
                  }`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 animate-fade-in">
            {error}
            <button onClick={() => setError(null)} className="ml-4 underline text-sm">Dismiss</button>
          </div>
        )}

        {/* Step Content */}
        <div className="animate-fade-in">
          {/* Step 1: Upload */}
          {step === "upload" && (
            <div className="max-w-2xl mx-auto">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-white mb-2">Upload Your Resume</h2>
                <p className="text-zinc-400">Our AI will analyze your profile and find the best matching jobs in Singapore</p>
              </div>

              <div
                className="gradient-border p-8 text-center cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".pdf,.txt,.doc,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <Upload className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-white mb-1">Drop your resume here</p>
                <p className="text-sm text-zinc-500">PDF, TXT, DOC (max 10MB)</p>
              </div>

              <div className="my-6 flex items-center gap-4">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-zinc-600 text-sm">or paste your resume text</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>

              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste your resume text here..."
                className="w-full h-48 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
              />
              <button
                onClick={handleTextParse}
                disabled={loading || !resumeText.trim()}
                className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {loading ? "Analyzing..." : "Analyze My Profile"}
              </button>
            </div>
          )}

          {/* Step 2: Discover */}
          {step === "discover" && profile && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Discover Jobs</h2>
                  <p className="text-zinc-400 text-sm">
                    Found for <span className="text-indigo-400">{profile.name}</span> · {profile.title} · {profile.experience_years} yrs exp
                  </p>
                </div>
                <button
                  onClick={() => setStep("upload")}
                  className="text-sm text-zinc-500 hover:text-zinc-300"
                >
                  Change resume
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">What role are you aiming for?</label>
                  <input
                    type="text"
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    placeholder="e.g., Product Manager, Data Analyst, Marketing Director..."
                    className="w-full px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Which industry? (Optional)</label>
                  <input
                    type="text"
                    value={targetIndustry}
                    onChange={(e) => setTargetIndustry(e.target.value)}
                    placeholder="e.g., Finance, Healthcare, Tech, Retail, Government..."
                    className="w-full px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Portal Selection */}
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-3">Search across portals</label>
                  <div className="flex flex-wrap gap-2">
                    {allSources.map(source => (
                      <button
                        key={source.key}
                        type="button"
                        onClick={() => toggleSource(source.key)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          selectedSources.includes(source.key)
                            ? `${source.bg} ${source.color} border border-current`
                            : "bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-600"
                        }`}
                      >
                        {selectedSources.includes(source.key) ? "✓ " : ""}{source.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-2">
                    MyCareersFuture is fastest. Web portals (JobStreet, Indeed, etc.) take longer but find more jobs.
                  </p>
                </div>

                <button
                  onClick={handleSearch}
                  disabled={loading || !targetRole}
                  className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                  {loading ? "Searching..." : `Find ${targetRole || 'Jobs'} in Singapore`}
                </button>
              </div>

              {jobs.length > 0 && (
                <div className="space-y-3">
                  {jobs.slice(0, 10).map((job) => (
                    <div
                      key={job.uuid}
                      className="gradient-border p-5 hover:opacity-90 transition-opacity cursor-pointer"
                      onClick={() => handleResumeRewrite(job)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-semibold text-white">{job.title}</h3>
                            {job.source && job.source !== "mcf" && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                job.source === "jobstreet" ? "bg-blue-500/20 text-blue-400" :
                                job.source === "indeed" ? "bg-indigo-500/20 text-indigo-400" :
                                job.source === "linkedin" ? "bg-sky-500/20 text-sky-400" :
                                job.source === "glassdoor" ? "bg-emerald-500/20 text-emerald-400" :
                                "bg-zinc-700 text-zinc-400"
                              }`}>
                                {job.source === "mcf" ? "MyCareersFuture" :
                                 job.source === "jobstreet" ? "JobStreet" :
                                 job.source === "indeed" ? "Indeed" :
                                 job.source === "linkedin" ? "LinkedIn" :
                                 job.source === "glassdoor" ? "Glassdoor" : job.source}
                              </span>
                            )}
                          </div>
                          <p className="text-zinc-400">{job.company}</p>
                          <div className="flex flex-wrap gap-3 mt-3 text-sm text-zinc-500">
                            {job.salary_min && (
                              <span className="flex items-center gap-1 text-green-400">
                                <DollarSign className="w-4 h-4" />
                                ${job.salary_min.toLocaleString()} - ${job.salary_max?.toLocaleString()} / {job.salary_type}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              {job.district || job.region}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {job.experience_required}+ yrs
                            </span>
                            <span className="flex items-center gap-1">
                              <Briefcase className="w-4 h-4" />
                              {job.position_level}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-3">
                            {job.skills.slice(0, 5).map((skill) => (
                              <span key={skill} className="px-2 py-1 rounded-full bg-zinc-800 text-xs text-zinc-400">
                                {skill}
                              </span>
                            ))}
                            {job.skills.length > 5 && (
                              <span className="px-2 py-1 rounded-full bg-zinc-800 text-xs text-zinc-500">
                                +{job.skills.length - 5} more
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="ml-4 text-right">
                          <div className={`text-2xl font-bold ${
                            job.match_score >= 70 ? "text-green-400" :
                            job.match_score >= 50 ? "text-yellow-400" : "text-zinc-500"
                          }`}>
                            {Math.round(job.match_score)}%
                          </div>
                          <div className="text-xs text-zinc-500">Match</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {jobs.length === 0 && !loading && (
                <div className="text-center py-16 text-zinc-500">
                  <Search className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <p>Click "Find Jobs" to search MyCareersFuture for matching roles</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Gap Analysis */}
          {step === "gaps" && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">Skill Gap Analysis</h2>
                <p className="text-zinc-400">What you need to close the gap between your profile and your target roles</p>
              </div>

              {!gapAnalysis ? (
                <button
                  onClick={handleGapAnalysis}
                  disabled={loading}
                  className="px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2 mx-auto"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Target className="w-5 h-5" />}
                  {loading ? "Analyzing..." : "Analyze My Gaps"}
                </button>
              ) : (
                <div className="space-y-6">
                  {/* Missing Skills */}
                  <div className="gradient-border p-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <Target className="w-5 h-5 text-indigo-400" />
                      Missing Skills
                    </h3>
                    <div className="space-y-3">
                      {gapAnalysis.missing_skills?.map((skill: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50">
                          <div>
                            <span className="font-medium text-white">{skill.skill}</span>
                            <span className={`ml-3 px-2 py-0.5 rounded-full text-xs ${
                              skill.urgency === "high" ? "bg-red-500/20 text-red-400" :
                              skill.urgency === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                              "bg-green-500/20 text-green-400"
                            }`}>
                              {skill.urgency}
                            </span>
                          </div>
                          <span className="text-sm text-zinc-500">
                            Found in {skill.found_in_jobs} jobs
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recommended Courses */}
                  <div className="gradient-border p-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-green-400" />
                      Recommended Courses (SkillsFuture Eligible)
                    </h3>
                    <div className="space-y-3">
                      {gapAnalysis.recommended_courses?.map((course: any, i: number) => (
                        <div key={i} className="p-4 rounded-lg bg-zinc-900/50">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-medium text-white">{course.name}</h4>
                              <p className="text-sm text-zinc-400">{course.provider}</p>
                              <div className="flex gap-3 mt-2 text-xs text-zinc-500">
                                <span>{course.duration}</span>
                                <span>${course.estimated_cost?.toLocaleString()} SGD</span>
                                <span className="text-green-400">{course.skillsfuture_subsidy}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {course.skills_covered?.map((s: string) => (
                              <span key={s} className="px-2 py-0.5 rounded-full bg-zinc-800 text-xs text-zinc-400">{s}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Salary Expectation */}
                  {gapAnalysis.salary_expectation && (
                    <div className="gradient-border p-6">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-yellow-400" />
                        Salary Expectation (Singapore)
                      </h3>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-4 rounded-lg bg-zinc-900/50">
                          <div className="text-2xl font-bold text-white">
                            ${gapAnalysis.salary_expectation.min?.toLocaleString()}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">Minimum</div>
                        </div>
                        <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                          <div className="text-2xl font-bold text-indigo-400">
                            ${gapAnalysis.salary_expectation.median?.toLocaleString()}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">Median</div>
                        </div>
                        <div className="p-4 rounded-lg bg-zinc-900/50">
                          <div className="text-2xl font-bold text-white">
                            ${gapAnalysis.salary_expectation.max?.toLocaleString()}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">Maximum</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setStep("prepare")}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                  >
                    Continue to Resume Prep <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Prepare */}
          {step === "prepare" && selectedJob && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Resume Rewrite</h2>
                  <p className="text-zinc-400 text-sm">
                    Optimized for: <span className="text-indigo-400">{selectedJob.title}</span> at <span className="text-indigo-400">{selectedJob.company}</span>
                  </p>
                </div>
                <button
                  onClick={() => setStep("discover")}
                  className="text-sm text-zinc-500 hover:text-zinc-300"
                >
                  Choose another job
                </button>
              </div>

              {!resumeRewrite ? (
                <button
                  onClick={() => handleResumeRewrite(selectedJob)}
                  disabled={loading}
                  className="px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2 mx-auto"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                  {loading ? "Rewriting..." : "Rewrite My Resume"}
                </button>
              ) : (
                <div className="space-y-6">
                  <div className="gradient-border p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-white">ATS Optimization Score</h3>
                      <span className={`text-2xl font-bold ${
                        resumeRewrite.ats_score >= 80 ? "text-green-400" :
                        resumeRewrite.ats_score >= 60 ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {Math.round(resumeRewrite.ats_score)}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-medium text-zinc-500 mb-2">Original Summary</h4>
                        <p className="text-sm text-zinc-400 bg-zinc-900/50 p-3 rounded-lg">{resumeRewrite.original_summary}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-indigo-400 mb-2">Optimized Summary</h4>
                        <p className="text-sm text-white bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/20">{resumeRewrite.rewritten_summary}</p>
                      </div>
                    </div>

                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-zinc-500 mb-2">Optimized Achievement Bullets</h4>
                      <ul className="space-y-2">
                        {resumeRewrite.optimized_bullets?.map((bullet: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                            <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-zinc-500 mb-2">Keywords Added for ATS</h4>
                      <div className="flex flex-wrap gap-2">
                        {resumeRewrite.keywords_added?.map((kw: string) => (
                          <span key={kw} className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-sm">{kw}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleInterviewPrep(selectedJob)}
                    disabled={loading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mb-3"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageSquare className="w-5 h-5" />}
                    {loading ? "Preparing..." : "Prepare for Interview"}
                  </button>

                  {/* Download Resume */}
                  <button
                    onClick={handleDownloadResume}
                    disabled={loading}
                    className="w-full py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white font-medium hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2 mb-3"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    {loading ? "Generating..." : "Download Optimized Resume"}
                  </button>

                  {/* Agentic Apply - The Holy Grail */}
                  <button
                    onClick={() => handleApply(selectedJob)}
                    disabled={applying || loading}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-lg shadow-lg shadow-green-500/20"
                  >
                    {applying ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
                    {applying ? "Applying..." : "🚀 Apply Now (Auto-Fill & Submit)"}
                  </button>

                  {applyResult && (
                    <div className={`mt-4 p-4 rounded-xl border ${
                      applyResult.success 
                        ? "bg-green-500/10 border-green-500/20" 
                        : "bg-yellow-500/10 border-yellow-500/20"
                    }`}>
                      <h4 className={`font-semibold mb-2 ${
                        applyResult.success ? "text-green-400" : "text-yellow-400"
                      }`}>
                        {applyResult.success ? "✅ Application Submitted!" : "⚠️ Application Needs Attention"}
                      </h4>
                      <div className="space-y-1 text-sm">
                        {applyResult.steps?.map((s: string, i: number) => (
                          <p key={i} className="text-zinc-400">• {s}</p>
                        ))}
                        {applyResult.errors?.map((e: string, i: number) => (
                          <p key={i} className="text-red-400">⚠ {e}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Interview */}
          {step === "interview" && selectedJob && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Interview Prep</h2>
                  <p className="text-zinc-400 text-sm">
                    For: <span className="text-indigo-400">{selectedJob.title}</span> at <span className="text-indigo-400">{selectedJob.company}</span>
                  </p>
                </div>
              </div>

              {!interviewPrep ? (
                <button
                  onClick={() => handleInterviewPrep(selectedJob)}
                  disabled={loading}
                  className="px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2 mx-auto"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageSquare className="w-5 h-5" />}
                  {loading ? "Generating..." : "Generate Interview Prep"}
                </button>
              ) : (
                <div className="space-y-6">
                  {/* Behavioral Questions */}
                  <div className="gradient-border p-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-indigo-400" />
                      Behavioral Questions (STAR Method)
                    </h3>
                    <div className="space-y-4">
                      {interviewPrep.behavioral_questions?.map((q: any, i: number) => (
                        <div key={i} className="p-4 rounded-lg bg-zinc-900/50">
                          <div className="flex items-start gap-3">
                            <span className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-bold shrink-0">
                              {i + 1}
                            </span>
                            <div>
                              <h4 className="font-medium text-white">{q.question}</h4>
                              <p className="text-sm text-zinc-500 mt-1">Why they ask: {q.why_asked}</p>
                              <p className="text-sm text-zinc-400 mt-2 p-3 rounded-lg bg-zinc-800/50">
                                <span className="text-indigo-400 font-medium">STAR Hint:</span> {q.star_framework_hint}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Technical Questions */}
                  <div className="gradient-border p-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <Star className="w-5 h-5 text-yellow-400" />
                      Technical Questions
                    </h3>
                    <div className="space-y-3">
                      {interviewPrep.technical_questions?.map((q: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50">
                          <div>
                            <span className="text-sm text-zinc-400">{q.topic}</span>
                            <p className="text-white font-medium">{q.question}</p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            q.difficulty === "hard" ? "bg-red-500/20 text-red-400" :
                            q.difficulty === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-green-500/20 text-green-400"
                          }`}>
                            {q.difficulty}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Company Research */}
                  {interviewPrep.company_research && (
                    <div className="gradient-border p-6">
                      <h3 className="text-lg font-semibold text-white mb-4">Company Research</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <h4 className="text-sm font-medium text-zinc-500 mb-2">Key Facts</h4>
                          <ul className="space-y-1">
                            {interviewPrep.company_research.key_facts?.map((f: string, i: number) => (
                              <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                                <span className="text-indigo-400">•</span>{f}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="text-sm font-medium text-zinc-500 mb-2">Recent News</h4>
                          <ul className="space-y-1">
                            {interviewPrep.company_research.recent_news?.map((n: string, i: number) => (
                              <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                                <span className="text-green-400">•</span>{n}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="text-sm font-medium text-zinc-500 mb-2">Culture Notes</h4>
                          <ul className="space-y-1">
                            {interviewPrep.company_research.culture_notes?.map((c: string, i: number) => (
                              <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                                <span className="text-yellow-400">•</span>{c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Negotiation Tips */}
                  {interviewPrep.negotiation_tips && (
                    <div className="gradient-border p-6">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-green-400" />
                        Salary Negotiation Tips (Singapore)
                      </h3>
                      <ul className="space-y-2">
                        {interviewPrep.negotiation_tips.map((tip: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                            <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 mt-16 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-zinc-600">
          <p>Built for the <span className="text-indigo-400">Meta Global AI Developer Hackathon 2026</span></p>
          <p className="mt-1">Powered by <span className="text-indigo-400">Llama 3.3 70B (Groq)</span> · Data from <span className="text-green-400">MyCareersFuture SG</span></p>
        </div>
      </footer>
        </>
      )}
    </div>
  );
}
