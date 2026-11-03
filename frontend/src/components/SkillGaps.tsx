"use client";
import { useEffect, useState } from "react";
import {
  Target, CheckCircle2, CircleDashed, CircleAlert, ExternalLink, ChevronDown, Wallet, TrendingUp, Landmark,
  ArrowRight, Sparkles, Search,
} from "lucide-react";
import { Button, Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import type { Profile } from "@/components/ProfileEditor";
import { postJson } from "@/lib/api";
import type { Job } from "@/lib/types";

interface SfwRole { id: number; role: string; sector: string; track: string; description: string; skill_count: number }
interface GapSkill {
  code: string; title: string; type: string; category: string; level: string; description: string;
  level_description: string; abilities: string[]; course_search_url: string;
  status: "strong" | "partial" | "gap"; evidence?: string; why_it_matters?: string; how_to_build?: string;
}
export interface GapResult {
  role: { id: number; role: string; sector: string; track: string; description: string; functions: string[] };
  overview: string;
  counts: { gap: number; partial: number; strong: number };
  skills: GapSkill[];
  other_skills: { title: string; level: string; type: string; description: string; course_search_url: string }[];
  market: { requested: { skill: string; jobs: number }[]; salary: { low?: number; high?: number; min?: number; max?: number; listings?: number }; job_count: number };
  source: string;
}

const STATUS = {
  gap: { label: "To build", tone: "danger" as const, icon: CircleAlert, color: "text-danger" },
  partial: { label: "Partly there", tone: "warning" as const, icon: CircleDashed, color: "text-warning" },
  strong: { label: "You have this", tone: "success" as const, icon: CheckCircle2, color: "text-success" },
};

const money = (n?: number) => (n ? `S$${n.toLocaleString()}` : "—");

function SkillRow({ s }: { s: GapSkill }) {
  const [open, setOpen] = useState(s.status !== "strong");
  const st = STATUS[s.status];
  const Icon = st.icon;
  return (
    <li className="px-5 sm:px-6 py-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-3 text-left" aria-expanded={open}>
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${st.color}`} />
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{s.title}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge>Level {s.level} of 6</Badge>
          </span>
          <span className="block text-xs text-muted mt-0.5">{s.type} · {s.category}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-subtle shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 ml-8 space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-0.5">What it is</p>
            <p className="text-text leading-relaxed">{s.description}</p>
          </div>
          {s.level_description && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-0.5">What level {s.level} looks like</p>
              <p className="text-text leading-relaxed">{s.level_description}</p>
            </div>
          )}
          {s.why_it_matters && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-0.5">Why it matters for this role</p>
              <p className="text-text leading-relaxed">{s.why_it_matters}</p>
            </div>
          )}
          {s.evidence && (
            <div className="rounded-lg bg-success-soft px-3 py-2">
              <p className="text-xs font-semibold text-success mb-0.5">From your profile</p>
              <p className="text-text">{s.evidence}</p>
            </div>
          )}
          {s.how_to_build && s.status !== "strong" && (
            <div className="rounded-lg bg-brand-soft px-3 py-2">
              <p className="text-xs font-semibold text-brand mb-0.5">How to build it</p>
              <p className="text-text">{s.how_to_build}</p>
            </div>
          )}
          <a href={s.course_search_url} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            Find courses on MySkillsFuture <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </li>
  );
}

export function SkillGaps({
  profile, targetRole, targetIndustry, jobs, result, setResult, onContinue, onError,
}: {
  profile: Profile;
  targetRole: string;
  targetIndustry: string;
  jobs: Job[];
  result: GapResult | null;
  setResult: (r: GapResult | null) => void;
  onContinue: () => void;
  onError: (m: string) => void;
}) {
  const [roles, setRoles] = useState<SfwRole[] | null>(null);
  const [roleId, setRoleId] = useState<number | null>(result?.role.id ?? null);
  const [showAllRoles, setShowAllRoles] = useState(false);
  const [loading, setLoading] = useState<"roles" | "gap" | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  // Find matching official roles once per target role
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading("roles");
      try {
        const form = new FormData();
        form.append("profile_json", JSON.stringify(profile));
        form.append("target_role", targetRole);
        form.append("target_industry", targetIndustry);
        const data = await postJson<{ roles: SfwRole[] }>("/api/skills/roles", form);
        if (cancelled) return;
        setRoles(data.roles);
        setRoleId(id => id ?? data.roles[0]?.id ?? null);
      } catch (e: any) {
        if (!cancelled) { setRoles([]); onError(e.message); }
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRole, targetIndustry]);

  const analyse = async () => {
    if (roleId == null) return;
    setLoading("gap");
    try {
      const form = new FormData();
      form.append("profile_json", JSON.stringify(profile));
      form.append("role_id", String(roleId));
      form.append("jobs_json", JSON.stringify(jobs.slice(0, 40).map(j => ({
        uuid: j.uuid, title: j.title, company: j.company, skills: j.skills, salary_min: j.salary_min, salary_max: j.salary_max,
      }))));
      setResult(await postJson<GapResult>("/api/skills/gap", form));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setLoading(null);
    }
  };

  const visibleRoles = showAllRoles ? roles ?? [] : (roles ?? []).slice(0, 4);

  return (
    <div className="space-y-6">
      {/* 1. Pick the official role */}
      <Card>
        <CardHeader icon={<Landmark className="w-[18px] h-[18px]" />} title="Your target role in the SkillsFuture Skills Framework"
                    subtitle="Singapore's official list of job roles and the skills each one needs. Pick the closest match." />
        <div className="px-5 sm:px-6 pb-5 space-y-3">
          {loading === "roles" && <p className="text-sm text-muted">Finding matching roles…</p>}
          {roles && roles.length === 0 && loading !== "roles" && (
            <p className="text-sm text-muted">No official role matched &quot;{targetRole}&quot;. Try a more general title on the Discover step.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleRoles.map(r => (
              <button key={r.id} type="button" onClick={() => { setRoleId(r.id); }} aria-pressed={roleId === r.id}
                      className={`rounded-lg border p-3 text-left transition-colors ${roleId === r.id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"}`}>
                <span className="block text-sm font-semibold text-ink">{r.role}</span>
                <span className="block text-xs text-muted mt-0.5">{r.sector} · {r.track} · {r.skill_count} skills</span>
              </button>
            ))}
          </div>
          {roles && roles.length > 4 && (
            <Button variant="ghost" size="sm" onClick={() => setShowAllRoles(s => !s)}>
              {showAllRoles ? "Show fewer" : `Show ${roles.length - 4} more roles`}
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between pt-2">
            <Button variant="ghost" onClick={onContinue}>Skip skill gaps <ArrowRight className="w-4 h-4" /></Button>
            <Button onClick={analyse} loading={loading === "gap"} disabled={roleId == null || loading !== null} icon={<Target className="w-4 h-4" />}>
              {loading === "gap" ? "Comparing your skills…" : result && result.role.id === roleId ? "Analyse again" : "Analyse my skills"}
            </Button>
          </div>
        </div>
      </Card>

      {!result && loading !== "gap" && (
        <EmptyState icon={<Search className="w-6 h-6" />} title="See exactly which skills this role needs"
                    description="We'll compare your profile with the official skill list, explain each gap in plain English, and show how to close it." />
      )}

      {result && (
        <>
          {/* 2. Overview */}
          <Card className="p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">{result.role.sector} · {result.role.track}</p>
            <h3 className="text-lg font-semibold text-ink mt-1">{result.role.role}</h3>
            <p className="text-sm text-muted mt-1 leading-relaxed">{result.role.description}</p>
            {result.role.functions.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">What the role involves</p>
                <div className="flex flex-wrap gap-1.5">{result.role.functions.map(f => <Badge key={f}>{f}</Badge>)}</div>
              </div>
            )}
            <div className="mt-5 grid grid-cols-3 gap-px rounded-lg overflow-hidden bg-line">
              {(["strong", "partial", "gap"] as const).map(k => (
                <div key={k} className="bg-surface px-3 py-3">
                  <p className={`text-2xl font-semibold tabular-nums ${STATUS[k].color}`}>{result.counts[k]}</p>
                  <p className="text-xs text-muted">{STATUS[k].label}</p>
                </div>
              ))}
            </div>
            {result.overview && (
              <p className="mt-4 flex gap-2 text-sm text-text leading-relaxed">
                <Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />{result.overview}
              </p>
            )}
          </Card>

          {/* 3. Skills, gaps first */}
          <Card>
            <CardHeader icon={<Target className="w-[18px] h-[18px]" />} title="Skills and competencies this role needs"
                        subtitle="Gaps first. Tap a skill for what it means, the level required, and how to build it." />
            <ul className="divide-y divide-line border-t border-line">
              {result.skills.map(s => <SkillRow key={s.code} s={s} />)}
            </ul>
            {result.other_skills.length > 0 && (
              <div className="border-t border-line px-5 sm:px-6 py-4">
                <Button variant="ghost" size="sm" onClick={() => setShowOthers(o => !o)}>
                  {showOthers ? "Hide" : "Show"} {result.other_skills.length} more skills listed for this role
                </Button>
                {showOthers && (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {result.other_skills.map(s => (
                      <li key={s.title} className="text-sm">
                        <a href={s.course_search_url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-brand">
                          {s.title}
                        </a>
                        <span className="text-xs text-muted"> · level {s.level}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          {/* 4. Market signals from the user's matched listings */}
          <div className="grid gap-6 lg:grid-cols-2">
            {result.market.requested.length > 0 && (
              <Card>
                <CardHeader icon={<TrendingUp className="w-[18px] h-[18px]" />} title="What employers are asking for"
                            subtitle={`Skills in your ${result.market.job_count} matched listings that aren't in your skills list yet`} />
                <ul className="divide-y divide-line border-t border-line">
                  {result.market.requested.map(r => (
                    <li key={r.skill} className="flex items-center justify-between gap-3 px-5 sm:px-6 py-2.5">
                      <span className="text-sm text-ink">{r.skill}</span>
                      <span className="text-xs text-muted whitespace-nowrap">in {r.jobs} jobs</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {result.market.salary.listings ? (
              <Card>
                <CardHeader icon={<Wallet className="w-[18px] h-[18px]" />} title="Salary in your matched listings"
                            subtitle={`Monthly, from ${result.market.salary.listings} real listings`} />
                <div className="grid grid-cols-2 gap-px bg-line border-t border-line rounded-b-xl overflow-hidden">
                  <div className="bg-surface px-5 py-4">
                    <p className="text-xs text-muted">Typical range</p>
                    <p className="mt-1 text-lg font-semibold text-ink tabular-nums">{money(result.market.salary.low)} – {money(result.market.salary.high)}</p>
                  </div>
                  <div className="bg-surface px-5 py-4">
                    <p className="text-xs text-muted">Lowest to highest</p>
                    <p className="mt-1 text-lg font-semibold text-ink tabular-nums">{money(result.market.salary.min)} – {money(result.market.salary.max)}</p>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>

          <p className="text-xs text-muted">Source: {result.source}. Explanations are AI-written from the official skill descriptions.</p>
          <div className="flex justify-end">
            <Button size="lg" onClick={onContinue}>Continue to tailoring <ArrowRight className="w-4 h-4" /></Button>
          </div>
        </>
      )}
    </div>
  );
}
