import { ShieldCheck } from "lucide-react";

export function UnavailablePage({ title }: { title: string }) {
  return (
    <section className="unavailable-page">
      <ShieldCheck size={28} />
      <p className="eyebrow eyebrow--accent">Transparent by design</p>
      <h1>{title}</h1>
      <p>
        This module stays disabled until its accounting, custody, and
        verification rules are backed by real on-chain data.
      </p>
    </section>
  );
}
