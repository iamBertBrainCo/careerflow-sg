"use client";
import { useState } from "react";
import { User, Mail, Phone, Link2, Globe, MapPin, X, Plus, ArrowRight, RefreshCw, Briefcase } from "lucide-react";
import { Button, Card, CardHeader, inputClass } from "@/components/ui";

export interface Profile {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  portfolio: string;
  location: string;
  title: string;
  summary: string;
  skills: string[];
  experience_years: number;
  education: string[];
  work_history: { company?: string; role?: string; duration?: string; achievements?: string[] }[];
  certifications: string[];
}

export const emptyContact = { email: "", phone: "", linkedin: "", portfolio: "", location: "" };

/** Details auto-apply needs before it can fill a real application form. */
export function missingApplyDetails(p: Profile | null): string[] {
  if (!p) return ["name", "email", "phone"];
  return (["name", "email", "phone"] as const).filter(k => !(p[k] || "").trim());
}

const detailFields = [
  { key: "name", label: "Full name", icon: User, placeholder: "Tan Wei Ming", type: "text", autoComplete: "name" },
  { key: "email", label: "Email", icon: Mail, placeholder: "you@example.com", type: "email", autoComplete: "email" },
  { key: "phone", label: "Phone", icon: Phone, placeholder: "+65 9123 4567", type: "tel", autoComplete: "tel" },
  { key: "location", label: "Location", icon: MapPin, placeholder: "Singapore", type: "text", autoComplete: "address-level2" },
  { key: "linkedin", label: "LinkedIn", icon: Link2, placeholder: "linkedin.com/in/yourname", type: "url", autoComplete: "url" },
  { key: "portfolio", label: "Portfolio / website", icon: Globe, placeholder: "yourname.com", type: "url", autoComplete: "url" },
] as const;

export function ProfileEditor({
  profile,
  onChange,
  onContinue,
  onReupload,
  highlight = [],
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  onContinue: () => void;
  onReupload: () => void;
  highlight?: string[];
}) {
  const [newSkill, setNewSkill] = useState("");
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => onChange({ ...profile, [key]: value });

  const addSkill = () => {
    const parts = newSkill.split(",").map(s => s.trim()).filter(Boolean);
    const existing = new Set(profile.skills.map(s => s.toLowerCase()));
    const fresh = parts.filter(s => !existing.has(s.toLowerCase()));
    if (fresh.length) set("skills", [...profile.skills, ...fresh]);
    setNewSkill("");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<User className="w-[18px] h-[18px]" />}
          title="My details"
          subtitle="Used on your generated resumes and application forms. Saved only in this browser."
        />
        <div className="grid gap-4 sm:grid-cols-2 px-5 sm:px-6 pb-6">
          {detailFields.map(({ key, label, icon: Icon, placeholder, type, autoComplete }) => {
            const flagged = highlight.includes(key);
            return (
              <div key={key}>
                <label htmlFor={`pd-${key}`} className="flex items-center gap-1.5 text-sm font-medium text-ink mb-1.5">
                  <Icon className="w-3.5 h-3.5 text-subtle" /> {label}
                  {flagged && <span className="text-danger font-normal">· needed to apply</span>}
                </label>
                <input
                  id={`pd-${key}`}
                  type={type}
                  autoComplete={autoComplete}
                  value={profile[key] || ""}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder={placeholder}
                  className={`${inputClass} ${flagged ? "border-danger" : ""}`}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<Briefcase className="w-[18px] h-[18px]" />}
          title="Professional profile"
          subtitle="Check what we read from your resume. Matching uses exactly what's here."
        />
        <div className="px-5 sm:px-6 pb-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div>
              <label htmlFor="pd-title" className="block text-sm font-medium text-ink mb-1.5">Current or most recent title</label>
              <input id="pd-title" value={profile.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="pd-years" className="block text-sm font-medium text-ink mb-1.5">Years of experience</label>
              <input
                id="pd-years"
                type="number"
                min={0}
                max={50}
                value={profile.experience_years}
                onChange={(e) => set("experience_years", Math.max(0, Number(e.target.value) || 0))}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-ink mb-1.5">Skills <span className="text-subtle font-normal">({profile.skills.length})</span></p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {profile.skills.map(skill => (
                <span key={skill} className="inline-flex items-center gap-1 rounded-md bg-brand-soft text-brand text-xs font-medium pl-2 pr-1 py-1">
                  {skill}
                  <button
                    type="button"
                    aria-label={`Remove ${skill}`}
                    onClick={() => set("skills", profile.skills.filter(s => s !== skill))}
                    className="rounded hover:bg-brand/15 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {profile.skills.length === 0 && <span className="text-sm text-muted">No skills yet. Add a few below.</span>}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); addSkill(); }}
              className="flex gap-2"
            >
              <input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                placeholder="Add a skill (comma-separate several)"
                className={inputClass}
                aria-label="Add a skill"
              />
              <Button type="submit" variant="secondary" disabled={!newSkill.trim()} icon={<Plus className="w-4 h-4" />}>
                Add
              </Button>
            </form>
          </div>

          <div>
            <label htmlFor="pd-summary" className="block text-sm font-medium text-ink mb-1.5">Summary</label>
            <textarea
              id="pd-summary"
              value={profile.summary}
              onChange={(e) => set("summary", e.target.value)}
              className={`${inputClass} h-28 py-3 resize-y leading-relaxed`}
            />
          </div>

          {profile.work_history?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink mb-1.5">Experience we found</p>
              <ul className="space-y-1.5">
                {profile.work_history.map((w, i) => (
                  <li key={i} className="text-sm text-text">
                    <span className="font-medium text-ink">{w.role || "Role"}</span>
                    {w.company && <> · {w.company}</>}
                    {w.duration && <span className="text-muted"> · {w.duration}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onReupload} icon={<RefreshCw className="w-4 h-4" />}>
          Use a different resume
        </Button>
        <Button size="lg" onClick={onContinue} disabled={!profile.title.trim() && profile.skills.length === 0}>
          Looks good, find jobs <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
