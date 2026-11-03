export interface Job {
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
  match_reason: string;
  matched_skills: string[];
  missing_skills: string[];
  score_breakdown: {
    title?: number; skills?: number; experience?: number; salary?: number;
    experience_note?: string; salary_note?: string; code?: number; ai?: number;
  };
  ai_ranked: boolean;
}

export interface ResumeDoc {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
  portfolio: string;
  location: string;
  summary: string;
  competencies: string[];
  experience: { company: string; role: string; location: string; period: string; bullets: string[] }[];
  education: { title: string; org: string; year: string }[];
  certifications: { title: string; org: string; year: string }[];
  skills: { category: string; items: string[] }[];
}

export interface AtsReport {
  score: number;
  checks: { id: string; label: string; passed: boolean; detail: string; weight: number }[];
  keywords_hit: string[];
  keywords_missing: string[];
}

export interface Tailored {
  status: "queued" | "working" | "done" | "error";
  error?: string;
  resume?: ResumeDoc;
  job_keywords?: string[];
  suggested_keywords?: string[];
  changes?: string[];
  ats?: AtsReport;
}

export interface TemplateInfo {
  id: string;
  label: string;
  ats_safe: boolean;
}
