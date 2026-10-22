import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SourceDocumentLinkProps {
  recordType: "entry" | "rope";
  recordId: number;
  /**
   * Optional verification token. When provided, the supervisor verification
   * page can use it to access the source document without being logged in.
   */
  verificationToken?: string;
  className?: string;
}

export function SourceDocumentLink({
  recordType,
  recordId,
  verificationToken,
  className,
}: SourceDocumentLinkProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        type: recordType,
        id: recordId.toString(),
      });
      if (verificationToken) {
        params.set("token", verificationToken);
      }
      const res = await fetch(`/api/source-document?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({}))) as { message?: unknown };
        const message =
          typeof body.message === "string"
            ? body.message
            : "Could not open the signed log";
        throw new Error(message);
      }
      const data: { url: string; name: string | null } = await res.json();
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: unknown) {
      const description =
        err instanceof Error ? err.message : "Please try again";
      toast({
        title: "Could not open log",
        description,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={
        className ??
        "inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
      }
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <ExternalLink className="h-3 w-3" />
      )}
      View signed log
    </button>
  );
}
