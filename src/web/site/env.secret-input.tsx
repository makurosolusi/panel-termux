import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { idSiteDetail } from "@/web/i18n/id.site-detail";

const t = idSiteDetail.env;

type SecretInputProps = {
  id: string;
  value: string;
  placeholder?: string;
  label: string;
  onChange: (v: string) => void;
};

/** Password input with a show/hide toggle (`aria-pressed`). */
export function SecretInput({ id: inputId, value, placeholder, label, onChange }: SecretInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex-1">
      <Input
        id={inputId}
        aria-label={label}
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        className="pr-9 pointer-coarse:pr-12"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5 pointer-coarse:top-0 pointer-coarse:right-0"
        aria-label={shown ? t.hide : t.show}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </Button>
    </div>
  );
}
