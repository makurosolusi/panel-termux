/** Renders an i18n sentence whose `backticked` parts are file names/commands as inline code. */
export function CodeText({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed split of a constant sentence, never reordered
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.8125em] break-all">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
