import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "success";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-strong shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2 shadow-card",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  success: "bg-success text-white hover:opacity-90 shadow-card",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-[15px] gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  block = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${block ? "w-full" : ""} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>{children}</div>
  );
}

export function CardHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-6">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text border-line",
  brand: "bg-brand-soft text-brand border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function levelTone(level?: string): Tone {
  const l = (level || "").toLowerCase();
  if (l === "high" || l === "hard") return "danger";
  if (l === "medium") return "warning";
  return "success";
}

export function scoreTone(score: number): Tone {
  if (score >= 70) return "success";
  if (score >= 50) return "warning";
  return "neutral";
}

/** Circular match/ATS score indicator. */
export function ScoreRing({ score, size = 52, label }: { score: number; size?: number; label?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(score || 0)));
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(value);
  const color =
    tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : "var(--subtle)";
  return (
    <div className="flex flex-col items-center shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - value / 100)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink tabular-nums">
          {value}
        </span>
      </div>
      {label && <span className="text-[11px] text-muted mt-1">{label}</span>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-brand mb-1.5">{eyebrow}</p>}
        <h2 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="text-[15px] text-muted mt-1.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="px-6 py-12 sm:py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-surface-2 text-muted flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="text-sm text-muted mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </Card>
  );
}

export const inputClass =
  "w-full h-11 px-3.5 rounded-lg bg-surface border border-line-strong text-ink placeholder:text-subtle text-[15px] focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft transition-shadow";
