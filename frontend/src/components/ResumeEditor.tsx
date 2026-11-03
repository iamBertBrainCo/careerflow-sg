"use client";
import { useState, type ReactNode } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { Button, inputClass } from "@/components/ui";
import type { ResumeDoc } from "@/lib/types";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink mb-1.5">
        {label} {hint && <span className="text-subtle font-normal">{hint}</span>}
      </p>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-5 space-y-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
      {children}
    </div>
  );
}

/** Edit every part of a tailored resume. Contact details come from My details. */
export function ResumeEditor({
  resume,
  onChange,
  suggestions = [],
}: {
  resume: ResumeDoc;
  onChange: (r: ResumeDoc) => void;
  suggestions?: string[];
}) {
  const [newCompetency, setNewCompetency] = useState("");
  const set = <K extends keyof ResumeDoc>(key: K, value: ResumeDoc[K]) => onChange({ ...resume, [key]: value });

  const addCompetency = (value: string) => {
    const v = value.trim();
    if (v && !resume.competencies.some(c => c.toLowerCase() === v.toLowerCase())) set("competencies", [...resume.competencies, v]);
  };
  const updateItem = <K extends "experience" | "education" | "skills">(key: K, index: number, patch: Partial<ResumeDoc[K][number]>) =>
    set(key, resume[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) as ResumeDoc[K]);
  const removeItem = <K extends "experience" | "education" | "skills">(key: K, index: number) =>
    set(key, resume[key].filter((_, i) => i !== index) as ResumeDoc[K]);

  const unusedSuggestions = suggestions.filter(s => !resume.competencies.some(c => c.toLowerCase() === s.toLowerCase()));

  return (
    <div className="space-y-5">
      <Field label="Headline title">
        <input value={resume.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
      </Field>

      <Field label="Professional summary" hint={`(${resume.summary.split(/\s+/).filter(Boolean).length} words)`}>
        <textarea
          value={resume.summary}
          onChange={(e) => set("summary", e.target.value)}
          className={`${inputClass} h-32 py-3 resize-y leading-relaxed`}
        />
      </Field>

      <Section title="Core competencies">
        <div className="flex flex-wrap gap-1.5">
          {resume.competencies.map(c => (
            <span key={c} className="inline-flex items-center gap-1 rounded-md bg-brand-soft text-brand text-xs font-medium pl-2 pr-1 py-1">
              {c}
              <button type="button" aria-label={`Remove ${c}`} className="rounded hover:bg-brand/15 p-0.5"
                      onClick={() => set("competencies", resume.competencies.filter(x => x !== c))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addCompetency(newCompetency); setNewCompetency(""); }} className="flex gap-2">
          <input value={newCompetency} onChange={(e) => setNewCompetency(e.target.value)} placeholder="Add a competency"
                 className={inputClass} aria-label="Add a competency" />
          <Button type="submit" variant="secondary" disabled={!newCompetency.trim()} icon={<Plus className="w-4 h-4" />}>Add</Button>
        </form>
        {unusedSuggestions.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
            <p className="text-xs font-semibold text-warning">The job also asks for these. Add them only if they&apos;re true for you:</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {unusedSuggestions.map(s => (
                <button key={s} type="button" onClick={() => addCompetency(s)}
                        className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-surface px-2 py-1 text-xs font-medium text-text hover:bg-surface-2">
                  <Plus className="w-3 h-3" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Work experience">
        {resume.experience.map((job, i) => (
          <div key={i} className="rounded-lg border border-line p-3 sm:p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={job.role} onChange={(e) => updateItem("experience", i, { role: e.target.value })}
                     placeholder="Job title" aria-label="Job title" className={inputClass} />
              <input value={job.company} onChange={(e) => updateItem("experience", i, { company: e.target.value })}
                     placeholder="Company" aria-label="Company" className={inputClass} />
              <input value={job.period} onChange={(e) => updateItem("experience", i, { period: e.target.value })}
                     placeholder="2021 – 2025" aria-label="Dates" className={inputClass} />
              <input value={job.location} onChange={(e) => updateItem("experience", i, { location: e.target.value })}
                     placeholder="Location (optional)" aria-label="Location" className={inputClass} />
            </div>
            <Field label="Achievements" hint="(one per line)">
              <textarea
                value={job.bullets.join("\n")}
                onChange={(e) => updateItem("experience", i, { bullets: e.target.value.split("\n") })}
                className={`${inputClass} h-28 py-2.5 resize-y leading-relaxed`}
              />
            </Field>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => removeItem("experience", i)} icon={<Trash2 className="w-3.5 h-3.5" />}>
                Remove role
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />}
                onClick={() => set("experience", [...resume.experience, { company: "", role: "", location: "", period: "", bullets: [] }])}>
          Add role
        </Button>
      </Section>

      <Section title="Skills">
        {resume.skills.map((group, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[160px_1fr_auto] items-start">
            <input value={group.category} onChange={(e) => updateItem("skills", i, { category: e.target.value })}
                   placeholder="Category" aria-label="Skill category" className={inputClass} />
            <input value={group.items.join(", ")}
                   onChange={(e) => updateItem("skills", i, { items: e.target.value.split(",").map(s => s.trimStart()) })}
                   placeholder="Comma-separated skills" aria-label="Skills" className={inputClass} />
            <Button variant="ghost" size="sm" aria-label="Remove skill group" onClick={() => removeItem("skills", i)} icon={<Trash2 className="w-3.5 h-3.5" />} />
          </div>
        ))}
        <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />}
                onClick={() => set("skills", [...resume.skills, { category: "", items: [] }])}>
          Add skill group
        </Button>
      </Section>

      <Section title="Education">
        {resume.education.map((ed, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto] items-start">
            <input value={ed.title} onChange={(e) => updateItem("education", i, { title: e.target.value })}
                   placeholder="Qualification" aria-label="Qualification" className={inputClass} />
            <input value={ed.org} onChange={(e) => updateItem("education", i, { org: e.target.value })}
                   placeholder="School" aria-label="School" className={inputClass} />
            <input value={ed.year} onChange={(e) => updateItem("education", i, { year: e.target.value })}
                   placeholder="Year" aria-label="Year" className={inputClass} />
            <Button variant="ghost" size="sm" aria-label="Remove education" onClick={() => removeItem("education", i)} icon={<Trash2 className="w-3.5 h-3.5" />} />
          </div>
        ))}
        <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />}
                onClick={() => set("education", [...resume.education, { title: "", org: "", year: "" }])}>
          Add education
        </Button>
      </Section>
    </div>
  );
}
