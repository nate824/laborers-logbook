import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Check } from "lucide-react";

interface DirectVerificationLinkProps {
  verificationUrl: string;
  onClose: () => void;
}

export function DirectVerificationLink({ verificationUrl, onClose }: DirectVerificationLinkProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    if (verificationUrl) {
      navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <Alert className="bg-primary/5 border border-primary/30">
        <AlertDescription className="flex flex-col gap-4">
          <p>
            Since the email service is not configured, please use this direct verification link:
          </p>
          <div className="relative">
            <Input 
              value={verificationUrl} 
              readOnly 
              className="pr-10 bg-white"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full aspect-square"
              onClick={copyToClipboard}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => window.open(verificationUrl, '_blank')}
            >
              Open Verification Page
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}