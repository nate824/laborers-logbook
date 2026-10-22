import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MailOpen } from "lucide-react";

interface EmailSentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EmailSentModal({ isOpen, onClose }: EmailSentModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex flex-col items-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
            <MailOpen className="h-6 w-6 text-green-600" />
          </div>
          <DialogTitle className="text-center">Verification Email Sent</DialogTitle>
        </DialogHeader>
        
        <div className="text-center text-sm text-neutral-500 mt-2">
          <p>
            An email has been sent to the supervisor for verification. 
            You'll be notified once the hours are verified.
          </p>
        </div>
        
        <DialogFooter className="mt-6 flex justify-center">
          <Button onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
