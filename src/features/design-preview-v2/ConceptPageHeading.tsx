import type { LucideIcon } from "lucide-react";

interface ConceptPageHeadingProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export function ConceptPageHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
}: ConceptPageHeadingProps) {
  return (
    <header className="concept-page-heading">
      <span className="concept-page-heading__icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
