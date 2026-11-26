import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { id } from "@/web/i18n/id";

/** Search field that applies on Enter/button (no per-keystroke requests). `list` links an optional <datalist>. */
export function SearchBox({
  initial,
  placeholder,
  label,
  list,
  onSearch,
}: {
  initial: string;
  placeholder: string;
  label: string;
  list?: string;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState(initial);
  return (
    <search className="flex flex-1">
      <form
        className="flex flex-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(q.trim());
        }}
      >
        <Input
          type="search"
          value={q}
          list={list}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="outline" size="icon" aria-label={id.dev.common.search}>
          <SearchIcon aria-hidden />
        </Button>
      </form>
    </search>
  );
}
