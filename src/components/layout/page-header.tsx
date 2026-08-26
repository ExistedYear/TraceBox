type PageHeaderProps = { eyebrow?: string; title: string; description?: string };

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return <div className="mb-8">{eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>}<h1 className="text-3xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>}</div>;
}
