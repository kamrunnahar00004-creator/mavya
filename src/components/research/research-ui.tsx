import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Calendar,
  ChevronDown,

  Database,
  ExternalLink,
  Heart,
  ListFilter,
  Lock,
  Search,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageBar } from "@/components/page-bar";
import { SaveButton } from "@/components/research/save-button";
import type { ResearchListing } from "@/lib/keyword-research";
import type { ShopRow } from "@/lib/research-store";
import {
  FREE_RESEARCH_SEARCHES,
  RESEARCH_BASE,
  RESEARCH_PAGE_SIZE,
  ageLabel,
  compact,
  money,
  researchHref,
  type ResearchKind,
  type ResearchTab,
  type SortDef,
} from "@/lib/research";

/**
 * Research screens (2026-09-26), laid out after Alura's research pages with
 * Mavya's colors and Mavya's rectangular buttons (6px corners, founder rule:
 * no round pill buttons). Server components; the only client piece is the
 * Save button. Every search is a plain GET form, so each result has a URL.
 */

export const btn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-4 text-[15px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-page)]";
export const btnPrimary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]";
const card = "min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white";
const TITLES: Record<ResearchKind, string> = { keyword: "Keyword Research", product: "Product Research", shop: "Shop Research" };

const researchTab = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-[13.5px] font-semibold transition-colors",
    active
      ? "border-[var(--color-primary)] bg-[var(--color-tint)] text-[var(--color-ink)]"
      : "border-[var(--color-border)] bg-white text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]"
  );

/** Top bar: "Keyword Research" plus Search / Explore / Saved. */
export function ResearchBar({ kind, tab }: { kind: ResearchKind; tab: ResearchTab }) {
  const tabs: { key: ResearchTab; label: string; Icon: LucideIcon }[] = [
    { key: "search", label: "Search", Icon: Search },
    { key: "explore", label: "Explore", Icon: Database },
    { key: "saved", label: "Saved", Icon: Heart },
  ];
  return (
    <PageBar
      crumbs={[{ label: TITLES[kind] }]}
      tabs={
        <nav aria-label={`${TITLES[kind]} views`} className="flex items-center gap-1.5">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.key === "search" ? RESEARCH_BASE[kind] : researchHref(kind, { tab: t.key })}
              aria-current={tab === t.key ? "page" : undefined}
              className={researchTab(tab === t.key)}
            >
              <t.Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {t.label}
            </Link>
          ))}
        </nav>
      }
    />
  );
}

export type HeroChip = { label: string; href: string; Icon: LucideIcon };

/** Big search field: search icon, input, square arrow button. */
export function SearchField({
  kind,
  q,
  placeholder,
  big,
  autoFocus,
  extra,
}: {
  kind: ResearchKind;
  q?: string | null;
  placeholder: string;
  big?: boolean;
  autoFocus?: boolean;
  extra?: Record<string, string>;
}) {
  return (
    <form action={RESEARCH_BASE[kind]} method="get" role="search" className={cn("w-full", big ? "max-w-[760px]" : "max-w-[560px]")}>
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white pl-4 pr-2 transition-colors focus-within:border-[var(--color-ink)]",
          big ? "h-[60px] shadow-[var(--shadow-soft)]" : "h-12"
        )}
      >
        <Search className="h-5 w-5 flex-shrink-0 text-[var(--color-ink-soft)]" aria-hidden="true" />
        <span className="sr-only">{placeholder}</span>
        <input
          name="q"
          defaultValue={q ?? ""}
          maxLength={200}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={placeholder}
          className={cn("min-w-0 flex-1 bg-transparent text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)]", big ? "text-[16.5px]" : "text-[15px]")}
        />
        <button
          type="submit"
          aria-label="Search"
          className={cn(
            "flex flex-shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white transition-colors hover:bg-[var(--color-primary-hover)]",
            big ? "h-10 w-10" : "h-8 w-8"
          )}
        >
          <ArrowRight className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </label>
    </form>
  );
}

/** The Search tab before a search: big centered title, search field, preset chips. */
export function SearchHero({
  kind,
  placeholder,
  chips,
  mine,
  note,
  error,
}: {
  kind: ResearchKind;
  placeholder: string;
  chips: HeroChip[];
  mine?: HeroChip[];
  note?: string;
  error?: string | null;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-97px-57px)] flex-col items-center justify-center px-4 pb-24 pt-10 lg:min-h-[calc(100dvh-57px)]">
      <h1 className="text-center text-[34px] font-semibold tracking-[-0.025em] text-[var(--color-ink)] sm:text-[42px]">{TITLES[kind]}</h1>
      <div className="mt-7 flex w-full justify-center">
        <SearchField kind={kind} placeholder={placeholder} big autoFocus />
      </div>
      <div className="mt-4 flex max-w-[860px] flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <Link key={c.label} href={c.href} className={cn(btn, "font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")}>
            <c.Icon className="h-4 w-4" aria-hidden="true" />
            {c.label}
          </Link>
        ))}
      </div>
      {mine && mine.length > 0 && (
        <div className="mt-3 flex max-w-[860px] flex-wrap items-center justify-center gap-2">
          <span className="text-[13px] text-[var(--color-ink-soft)]">From your listings:</span>
          {mine.map((c) => (
            <Link key={c.label} href={c.href} className={cn(btn, "h-8 font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")}>
              <c.Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {c.label}
            </Link>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-5 text-[14px] font-medium text-[var(--color-weak)]">
          {error}
        </p>
      )}
      {note && <p className="mt-6 max-w-[60ch] text-center text-[12.5px] text-[var(--color-ink-soft)]">{note}</p>}
    </div>
  );
}

/** Dropdown built on <details>, so it works without JavaScript. */
export function Menu({ label, Icon, children, align = "left" }: { label: ReactNode; Icon?: LucideIcon; children: ReactNode; align?: "left" | "right" }) {
  return (
    <details className="group relative">
      <summary className={cn(btn, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-[var(--color-ink-soft)] transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div
        className={cn(
          "absolute top-[calc(100%+6px)] z-30 min-w-[220px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-1 shadow-[var(--shadow-soft-strong)]",
          align === "right" ? "right-0" : "left-0"
        )}
      >
        {children}
      </div>
    </details>
  );
}

export function MenuLink({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 text-[13.5px] transition-colors hover:bg-[var(--color-page)]",
        active ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"
      )}
    >
      {children}
      {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />}
    </Link>
  );
}

/** Explore toolbar: filters on the left, sort and search on the right. */
export function Toolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-white px-4 py-3 sm:px-8">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{left}</div>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

export function SortMenu({ kind, sorts, sort, params }: { kind: ResearchKind; sorts: SortDef[]; sort: SortDef; params: Record<string, string | number | null> }) {
  return (
    <Menu label={<span>Sort: {sort.label}</span>} align="right">
      {sorts.map((s) => (
        <MenuLink key={s.key} href={researchHref(kind, { ...params, sort: s.key, page: null })} active={s.key === sort.key}>
          {s.label}
        </MenuLink>
      ))}
    </Menu>
  );
}

const AGES = [30, 90, 180, 365];

/** "Listing age | less than or equal | 90 | x" filter chip, or the Filter menu to add it. */
export function AgeFilter({ kind, age, params, noun }: { kind: ResearchKind; age: number | null; params: Record<string, string | number | null>; noun: string }) {
  return (
    <>
      <Menu label={age === null ? "Filter" : ""} Icon={ListFilter}>
        <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-[var(--color-ink-soft)]">{noun} age</p>
        {AGES.map((a) => (
          <MenuLink key={a} href={researchHref(kind, { ...params, age: a, page: null })} active={a === age}>
            {a === 365 ? "1 year or newer" : `${a} days or newer`}
          </MenuLink>
        ))}
      </Menu>
      {age !== null && (
        <span className="inline-flex h-9 items-stretch overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-[13.5px]">
          <span className="flex items-center gap-1.5 border-r border-[var(--color-border-soft)] px-3 font-semibold text-[var(--color-ink)]">
            <Calendar className="h-4 w-4 text-[var(--color-ink-muted)]" aria-hidden="true" />
            <span className="hidden sm:inline">{noun} age</span>
            <span className="sm:hidden">Age</span>
          </span>
          <span className="flex items-center border-r border-[var(--color-border-soft)] px-3 text-[var(--color-ink-muted)]">
            <span className="hidden sm:inline">less than or equal</span>
            <span className="sm:hidden" aria-label="less than or equal">≤</span>
          </span>
          <span className="flex items-center border-r border-[var(--color-border-soft)] px-3 font-semibold tabular-nums text-[var(--color-ink)]">{age} days</span>
          <Link href={researchHref(kind, { ...params, age: null, page: null })} aria-label="Remove age filter" className="flex items-center px-2.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-page)] hover:text-[var(--color-ink)]">
            <X className="h-4 w-4" aria-hidden="true" />
          </Link>
        </span>
      )}
    </>
  );
}

export type FilterDef = { key: string; label: string; op: string; options: readonly number[] };

/** Alura-style Filter button (menu of filters) plus one segmented chip per active filter. */
export function FilterMenu({
  kind,
  defs,
  values,
  params,
}: {
  kind: ResearchKind;
  defs: readonly FilterDef[];
  values: Record<string, number | null>;
  params: Record<string, string | number | null>;
}) {
  return (
    <>
      <Menu label="Filter" Icon={ListFilter}>
        {defs.map((d) => (
          <div key={d.key} className="pb-1">
            <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-[var(--color-ink-soft)]">
              {d.label} {d.op}
            </p>
            {d.options.map((o) => (
              <MenuLink key={o} href={researchHref(kind, { ...params, [d.key]: o, page: null })} active={values[d.key] === o}>
                {o.toLocaleString("en-US")}
              </MenuLink>
            ))}
          </div>
        ))}
      </Menu>
      {defs
        .filter((d) => values[d.key] !== null && values[d.key] !== undefined)
        .map((d) => (
          <span key={d.key} className="inline-flex h-10 items-stretch overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-[14px]">
            <span className="flex items-center border-r border-[var(--color-border-soft)] px-3 font-semibold text-[var(--color-ink)]">{d.label}</span>
            <span className="hidden items-center border-r border-[var(--color-border-soft)] px-3 text-[var(--color-ink-muted)] sm:flex">{d.op}</span>
            <span className="flex items-center border-r border-[var(--color-border-soft)] px-3 font-semibold tabular-nums text-[var(--color-ink)]">
              {(values[d.key] as number).toLocaleString("en-US")}
            </span>
            <Link href={researchHref(kind, { ...params, [d.key]: null, page: null })} aria-label={`Remove ${d.label} filter`} className="flex items-center px-2.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-page)] hover:text-[var(--color-ink)]">
              <X className="h-4 w-4" aria-hidden="true" />
            </Link>
          </span>
        ))}
    </>
  );
}

/** "1-25 of N results" plus Previous / Next. */
export function Pager({ kind, page, total, params, locked }: { kind: ResearchKind; page: number; total: number; params: Record<string, string | number | null>; locked?: boolean }) {
  const from = total === 0 ? 0 : (page - 1) * RESEARCH_PAGE_SIZE + 1;
  const to = Math.min(total, page * RESEARCH_PAGE_SIZE);
  const hasNext = to < total && page < 40;
  const off = "pointer-events-none opacity-40";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-white px-4 py-4 sm:px-7">
      <p className="text-[16px] text-[var(--color-ink)]">
        {from}-{to} of {total.toLocaleString("en-US")} results
      </p>
      <div className="flex items-center gap-2">
        <Link href={researchHref(kind, { ...params, page: page - 1 > 1 ? page - 1 : null })} aria-disabled={page <= 1} className={cn(btn, "h-11 px-5 text-[16px]", page <= 1 && off)}>
          Previous
        </Link>
        <Link href={researchHref(kind, { ...params, page: page + 1 })} aria-disabled={!hasNext} className={cn(btn, "h-11 px-5 text-[16px]", !hasNext && off)}>
          {locked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
          Next
        </Link>
      </div>
    </div>
  );
}

export function EmptyState({ Icon, title, body, action }: { Icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[460px] flex-col items-center px-4 py-20 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white text-[var(--color-ink-muted)]">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 text-[16px] font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={cn(card, "mx-4 mt-6 p-5 text-[14.5px] text-[var(--color-weak)] sm:mx-8")}>
      {children}
    </p>
  );
}

/** Shown to free accounts after their free searches (and on locked pages). */
export function UpgradeModal({ closeHref, reason }: { closeHref: string; reason: "searches" | "explore" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(24,24,27,0.45)] px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="upgrade-title" className="w-full max-w-[440px] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft-strong)]">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-tint)] text-[var(--color-primary)]">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
          <Link href={closeHref} aria-label="Close" className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-page)] hover:text-[var(--color-ink)]">
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </Link>
        </div>
        <h2 id="upgrade-title" className="mt-4 text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
          {reason === "searches" ? `You have used your ${FREE_RESEARCH_SEARCHES} free searches this week` : "See every result with a plan"}
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
          Plans include keyword, product, and shop research every day, the full Explore lists, and daily sales for the shops you save. Plus Mavya&apos;s checks and fixes for your own listings.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/subscribe" className={btnPrimary}>
            See plans <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href={closeHref} className={cn(btn, "h-10 px-4")}>
            Not now
          </Link>
        </div>
      </div>
    </div>
  );
}

function Thumb({ src, size = 72 }: { src: string | null; size?: number }) {
  return (
    <span className="flex-shrink-0 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-page-deep)]" style={{ width: size, height: size }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[76px] text-right">
      <p className="text-[12.5px] text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-[-0.01em] text-[var(--color-ink)]">{value}</p>
      {sub && <p className="text-[11.5px] text-[var(--color-ink-soft)]">{sub}</p>}
    </div>
  );
}

const Dot = () => <span className="text-[var(--color-ink-soft)]" aria-hidden="true">·</span>;

/** Product rows: photo, title, "age · price · favorites", then Views and Views a day. */
export function ProductRows({ rows, saved }: { rows: ResearchListing[]; saved: Set<string> }) {
  return (
    <ul className="flex flex-col gap-3 px-4 py-5 sm:px-8">
      {rows.map((t) => (
        <li key={t.listingId} className={cn(card, "flex items-center gap-4 p-3 pr-4 transition-colors hover:border-[var(--color-border-strong)] sm:p-4")}>
          <Thumb src={t.image} />
          <div className="min-w-0 flex-1">
            {t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--color-ink)] hover:underline">
                {t.title}
              </a>
            ) : (
              <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{t.title}</p>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--color-ink-muted)]">
              <span>{ageLabel(t.ageDays)}</span>
              <Dot />
              <span>{money(t.priceCents, t.currency)}</span>
              <Dot />
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3.5 w-3.5 fill-[var(--color-primary)] text-[var(--color-primary)]" aria-hidden="true" />
                {compact(t.favorites)}
              </span>
              <span className="sm:hidden">
                <Dot /> {compact(t.views)} views <Dot /> {compact(t.viewsPerDay)}/day
              </span>
            </p>
          </div>
          <div className="hidden items-center gap-6 sm:flex">
            <Stat label="Views" value={compact(t.views)} />
            <Stat label="Views/day" value={compact(t.viewsPerDay)} />
          </div>
          <SaveButton kind="product" refId={String(t.listingId)} label={t.title} initial={saved.has(String(t.listingId))} />
        </li>
      ))}
    </ul>
  );
}

export function ShopIcon({ src, name, size = 56 }: { src: string | null; name: string; size?: number }) {
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] bg-[var(--color-page-deep)] text-[18px] font-semibold text-[var(--color-ink-muted)]"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export function Rating({ avg, count }: { avg: number | null; count: number | null }) {
  if (avg === null || !count) return <span>No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="h-3.5 w-3.5 fill-[#F5A524] text-[#F5A524]" aria-hidden="true" />
      <span className="font-medium text-[var(--color-ink)]">{avg.toFixed(2).replace(/0$/, "")}</span>({count.toLocaleString("en-US")})
    </span>
  );
}

/** Shop rows: icon, name, "opened · rating", then Sales, Sales a day, Favorites, Listings. */
export function ShopRows({ rows, saved }: { rows: ShopRow[]; saved: Set<string> }) {
  return (
    <ul className="flex flex-col gap-3 px-4 py-5 sm:px-8">
      {rows.map((s) => (
        <li key={s.shopId} className={cn(card, "flex items-center gap-4 p-3 pr-4 transition-colors hover:border-[var(--color-border-strong)] sm:p-4")}>
          <ShopIcon src={s.iconUrl} name={s.shopName} />
          <div className="min-w-0 flex-1">
            <Link href={researchHref("shop", { id: s.shopId })} className="text-[15.5px] font-semibold text-[var(--color-ink)] hover:underline">
              {s.shopName}
            </Link>
            {s.title && <p className="truncate text-[13px] text-[var(--color-ink-muted)]">{s.title}</p>}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--color-ink-muted)]">
              <span>Opened {ageLabel(s.ageDays)} ago</span>
              <Dot />
              <Rating avg={s.reviewAverage} count={s.reviewCount} />
              <span className="sm:hidden">
                <Dot /> {compact(s.soldCount)} sales
              </span>
            </p>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <Stat label="Sales" value={compact(s.soldCount)} />
            <Stat label="Sales/day" value={s.sales ? compact(s.sales.perDay) : "–"} sub={s.sales ? undefined : "save to track"} />
            <Stat label="Favorites" value={compact(s.favorers)} />
            <Stat label="Listings" value={compact(s.activeListings)} />
          </div>
          <div className="hidden sm:block md:hidden">
            <Stat label="Sales" value={compact(s.soldCount)} />
          </div>
          <SaveButton kind="shop" refId={String(s.shopId)} label={s.shopName} initial={saved.has(String(s.shopId))} />
        </li>
      ))}
    </ul>
  );
}

/** Stat tile row used by keyword and shop detail pages. */
export function StatTiles({ items }: { items: { label: string; value: string; sub?: string; Icon: LucideIcon }[] }) {
  return (
    <section aria-label="Numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className={cn(card, "p-4 sm:p-5")}>
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)]">
            <s.Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{s.label}</span>
          </p>
          <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--color-ink)]">{s.value}</p>
          {s.sub && <p className="mt-2 text-[12.5px] text-[var(--color-ink-muted)]">{s.sub}</p>}
        </div>
      ))}
    </section>
  );
}

export function EtsyLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={btn}>
      {children} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}


