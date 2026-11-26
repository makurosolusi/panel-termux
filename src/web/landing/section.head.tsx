/** Section heading block: mono "§nn" kicker above a serif title (`onDark` for dark bands); `id` labels the parent section. */
export function SectionHead({
  id,
  kicker,
  title,
  onDark = false,
}: {
  id: string;
  kicker: string;
  title: string;
  onDark?: boolean;
}) {
  return (
    <div className="max-w-3xl">
      <p
        className={`font-lp-mono text-xs tracking-wider uppercase ${onDark ? "text-lp-signal-bright" : "text-lp-signal"}`}
      >
        {kicker}
      </p>
      <h2
        id={id}
        className="mt-3 font-lp-serif text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
      >
        {title}
      </h2>
    </div>
  );
}
